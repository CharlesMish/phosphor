import {
  HARMONIC_COUNT,
  normalizeWave,
  waveformToCoefficients,
} from "./waveform";
import { midiToHz } from "./keyboard-map";
import { SPACE_DEFAULT_SECONDS, buildSpaceBuffer } from "./space";
import { buildOutputSafetyCurve } from "./safety";

const MAX_VOICES = 12;
const VOICE_GAIN = 0.22;
const CROSSFADE = 0.02;
const SPACE_FADE = 0.07;
const WAVE_THROTTLE_MS = 32;
const MIN_ATTACK = 0.004;
const MIN_RELEASE = 0.03;

type SpaceSpec = { contour: number[]; seed: number; metal: boolean; seconds: number };

type Voice = {
  midi: number;
  freq: number;
  osc: OscillatorNode;
  mix: GainNode;
  env: GainNode;
  releasing: boolean;
  born: number;
};

export type SynthParams = {
  attack: number;
  release: number;
  volume: number;
  cutoff: number;
};

function cutoffHz(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 180 * Math.pow(18000 / 180, x);
}

function volumeToGain(v: number): number {
  const x = Math.min(1, Math.max(0, v));
  return x * x;
}

function AudioContextCtor(): (new (opts?: AudioContextOptions) => AudioContext) | null {
  if (typeof globalThis === "undefined") return null;
  const g = globalThis as typeof globalThis & {
    AudioContext?: new (opts?: AudioContextOptions) => AudioContext;
    webkitAudioContext?: new (opts?: AudioContextOptions) => AudioContext;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

function equalPower(mix: number): { dry: number; wet: number } {
  const x = Math.min(1, Math.max(0, mix));
  const a = x * (Math.PI / 2);
  return { dry: Math.cos(a), wet: Math.sin(a) };
}

function analyserPeak(analyser: AnalyserNode | null): number {
  if (!analyser) return 0;
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i] ?? 0);
    if (a > peak) peak = a;
  }
  return peak;
}

export class SynthEngine {
  private ctx: AudioContext | null = null;
  private filter: BiquadFilterNode | null = null;
  private bus: GainNode | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private dryGain: GainNode | null = null;
  private wetIn: GainNode | null = null;
  private convA: ConvolverNode | null = null;
  private convB: ConvolverNode | null = null;
  private wetA: GainNode | null = null;
  private wetB: GainNode | null = null;
  private sum: GainNode | null = null;
  private convActive: 0 | 1 = 0;
  private spaceReady = false;
  private spaceFadeUntil = 0;
  private spaceTimer: number | null = null;
  private wave: PeriodicWave | null = null;
  private voices = new Map<number, Voice>();
  private params: SynthParams = {
    attack: 0.04,
    release: 0.28,
    volume: 0.72,
    cutoff: 1,
  };
  private spaceMix = 0.38;
  private lastWaveAt = 0;
  private pendingSamples: number[] | null = null;
  private space: SpaceSpec | null = null;
  private pendingSpace: SpaceSpec | null = null;
  private waveTimer: number | null = null;
  private voiceListeners = new Set<(active: number[]) => void>();
  private readyListeners = new Set<(ready: boolean) => void>();
  private preSafetyAnalyser: AnalyserNode | null = null;
  private safety: WaveShaperNode | null = null;
  ready = false;

  onVoices(fn: (active: number[]) => void): () => void {
    this.voiceListeners.add(fn);
    return () => this.voiceListeners.delete(fn);
  }

  onReady(fn: (ready: boolean) => void): () => void {
    this.readyListeners.add(fn);
    return () => this.readyListeners.delete(fn);
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  getContext(): AudioContext | null {
    return this.ctx;
  }

  measurePeak(): number {
    return analyserPeak(this.analyser);
  }

  /** Peak immediately before final safety; useful for gain-staging QA. */
  measurePreSafetyPeak(): number {
    return analyserPeak(this.preSafetyAnalyser);
  }

  /** Must be called synchronously inside a user gesture. */
  unlock(): boolean {
    const Ctor = AudioContextCtor();
    if (!Ctor) return false;
    if (!this.ctx) {
      this.ctx = new Ctor({ latencyHint: "interactive" });
      this.buildGraph();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    if (!this.ready) {
      this.ready = true;
      this.readyListeners.forEach((fn) => fn(true));
    }
    return true;
  }

  setParams(partial: Partial<SynthParams>) {
    this.params = { ...this.params, ...partial };
    const now = this.ctx?.currentTime ?? 0;
    if (this.master && partial.volume !== undefined) {
      this.master.gain.setTargetAtTime(volumeToGain(this.params.volume), now, 0.03);
    }
    if (this.filter && partial.cutoff !== undefined) {
      this.filter.frequency.setTargetAtTime(cutoffHz(this.params.cutoff), now, 0.03);
    }
  }

  setSpaceMix(mix: number) {
    this.spaceMix = Math.min(1, Math.max(0, mix));
    this.applyMix();
  }

  setSpace(
    contour: number[],
    seed: number,
    metal = false,
    seconds = SPACE_DEFAULT_SECONDS,
  ) {
    const next = { contour, seed, metal, seconds };
    this.space = next;
    this.pendingSpace = next;
    if (!this.ctx) return;
    this.flushSpace();
  }

  setWaveform(samples: number[], immediate = false) {
    this.pendingSamples = samples;
    if (!this.ctx) return;
    if (immediate) {
      this.flushWaveform();
      return;
    }
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    const wait = Math.max(0, WAVE_THROTTLE_MS - (now - this.lastWaveAt));
    if (this.waveTimer !== null) return;
    if (typeof window === "undefined") {
      this.flushWaveform();
      return;
    }
    this.waveTimer = window.setTimeout(() => {
      this.waveTimer = null;
      this.flushWaveform();
    }, wait);
  }

  noteOn(midi: number) {
    if (!this.unlock() || !this.ctx || !this.filter || !this.wave) return;
    const existing = this.voices.get(midi);
    if (existing && !existing.releasing) return;
    if (existing) {
      this.voices.delete(midi);
      this.fadeOut(existing, 0.01);
    }

    this.stealIfNeeded();

    const now = this.ctx.currentTime;
    const freq = midiToHz(midi);
    const attack = Math.max(MIN_ATTACK, this.params.attack);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(VOICE_GAIN, now + attack);
    env.connect(this.filter);

    const mix = this.ctx.createGain();
    mix.gain.setValueAtTime(1, now);
    mix.connect(env);

    const osc = this.ctx.createOscillator();
    osc.setPeriodicWave(this.wave);
    osc.frequency.setValueAtTime(freq, now);
    osc.connect(mix);
    osc.start(now);

    const voice: Voice = {
      midi,
      freq,
      osc,
      mix,
      env,
      releasing: false,
      born: performance.now(),
    };
    this.voices.set(midi, voice);
    this.rebalance(now);
    this.emitVoices();
  }

  noteOff(midi: number) {
    const voice = this.voices.get(midi);
    if (!voice || voice.releasing || !this.ctx) return;
    this.releaseVoice(voice);
  }

  allNotesOff() {
    if (!this.ctx) return;
    for (const voice of [...this.voices.values()]) {
      this.voices.delete(voice.midi);
      this.fadeOut(voice, 0.012);
    }
    this.rebalance(this.ctx.currentTime);
    this.emitVoices();
  }

  dispose() {
    this.allNotesOff();
    if (this.waveTimer !== null) window.clearTimeout(this.waveTimer);
    if (this.spaceTimer !== null) window.clearTimeout(this.spaceTimer);
    this.pendingSpace = this.space;
    void this.ctx?.close();
    this.ctx = null;
    this.ready = false;
  }

  private buildGraph() {
    if (!this.ctx) return;
    const ctx = this.ctx;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.7;
    filter.frequency.value = cutoffHz(this.params.cutoff);

    const bus = ctx.createGain();
    bus.gain.value = 1;

    const dryGain = ctx.createGain();
    const wetIn = ctx.createGain();
    const convA = ctx.createConvolver();
    const convB = ctx.createConvolver();
    convA.normalize = false;
    convB.normalize = false;
    const silent = ctx.createBuffer(2, 8, ctx.sampleRate);
    convA.buffer = silent;
    convB.buffer = silent;

    const wetA = ctx.createGain();
    const wetB = ctx.createGain();
    wetA.gain.value = 1;
    wetB.gain.value = 0;

    const sum = ctx.createGain();
    sum.gain.value = 1;

    const master = ctx.createGain();
    master.gain.value = volumeToGain(this.params.volume);

    const preSafetyAnalyser = ctx.createAnalyser();
    preSafetyAnalyser.fftSize = 2048;
    preSafetyAnalyser.smoothingTimeConstant = 0.1;

    const safety = ctx.createWaveShaper();
    safety.curve = buildOutputSafetyCurve();
    safety.oversample = "none";

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.1;

    filter.connect(bus);
    bus.connect(dryGain);
    bus.connect(wetIn);
    wetIn.connect(convA);
    wetIn.connect(convB);
    convA.connect(wetA);
    convB.connect(wetB);
    dryGain.connect(sum);
    wetA.connect(sum);
    wetB.connect(sum);
    sum.connect(master);
    master.connect(preSafetyAnalyser);
    preSafetyAnalyser.connect(safety);
    safety.connect(analyser);
    analyser.connect(ctx.destination);

    this.filter = filter;
    this.bus = bus;
    this.dryGain = dryGain;
    this.wetIn = wetIn;
    this.convA = convA;
    this.convB = convB;
    this.wetA = wetA;
    this.wetB = wetB;
    this.sum = sum;
    this.master = master;
    this.preSafetyAnalyser = preSafetyAnalyser;
    this.safety = safety;
    this.analyser = analyser;
    this.convActive = 0;
    this.spaceReady = false;
    this.spaceFadeUntil = 0;

    this.applyMix();

    if (this.pendingSamples) this.flushWaveform();
    else this.wave = ctx.createPeriodicWave(new Float32Array([0, 0]), new Float32Array([0, 0]));
    if (this.space) {
      this.pendingSpace = this.space;
      this.flushSpace();
    }
  }

  private applyMix() {
    if (!this.dryGain || !this.wetIn) return;
    const now = this.ctx?.currentTime ?? 0;
    const { dry, wet } = equalPower(this.spaceMix);
    this.dryGain.gain.setTargetAtTime(dry, now, 0.03);
    this.wetIn.gain.setTargetAtTime(wet, now, 0.03);
  }

  private flushSpace() {
    const pending = this.pendingSpace;
    if (!pending || !this.ctx || !this.convA || !this.convB || !this.wetA || !this.wetB) return;
    const now = this.ctx.currentTime;
    const remaining = this.spaceFadeUntil - now;
    if (this.spaceReady && remaining > 0.0005) {
      this.scheduleSpaceFlush(remaining);
      return;
    }

    if (this.spaceTimer !== null) {
      window.clearTimeout(this.spaceTimer);
      this.spaceTimer = null;
    }

    const buffer = buildSpaceBuffer(
      pending.contour,
      pending.seed,
      this.ctx,
      pending.metal,
      pending.seconds,
    );
    this.pendingSpace = null;

    if (!this.spaceReady) {
      this.convA.buffer = buffer;
      this.wetA.gain.setValueAtTime(1, now);
      this.wetB.gain.setValueAtTime(0, now);
      this.convActive = 0;
      this.spaceReady = true;
      return;
    }

    const useB = this.convActive === 0;
    const incoming = useB ? this.convB : this.convA;
    const incomingGain = useB ? this.wetB : this.wetA;
    const outgoingGain = useB ? this.wetA : this.wetB;
    incoming.buffer = buffer;

    incomingGain.gain.cancelScheduledValues(now);
    outgoingGain.gain.cancelScheduledValues(now);
    incomingGain.gain.setValueAtTime(0, now);
    incomingGain.gain.linearRampToValueAtTime(1, now + SPACE_FADE);
    outgoingGain.gain.setValueAtTime(1, now);
    outgoingGain.gain.linearRampToValueAtTime(0, now + SPACE_FADE);
    this.convActive = useB ? 1 : 0;
    this.spaceFadeUntil = now + SPACE_FADE;
  }

  private scheduleSpaceFlush(seconds: number) {
    if (this.spaceTimer !== null || typeof window === "undefined") return;
    this.spaceTimer = window.setTimeout(() => {
      this.spaceTimer = null;
      this.flushSpace();
    }, Math.ceil((seconds + 0.005) * 1000));
  }

  private flushWaveform() {
    const samples = this.pendingSamples;
    if (!samples || !this.ctx) return;
    this.lastWaveAt = typeof performance !== "undefined" ? performance.now() : 0;

    const conditioned = normalizeWave(samples, 0.9);
    const { real, imag } = waveformToCoefficients(conditioned, HARMONIC_COUNT);
    const wave = this.ctx.createPeriodicWave(real, imag, { disableNormalization: true });
    this.wave = wave;

    const live = [...this.voices.values()].filter((v) => !v.releasing);
    if (live.length === 0) return;
    this.crossfadeVoices(live, wave);
  }

  private crossfadeVoices(live: Voice[], wave: PeriodicWave) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const fade = CROSSFADE;

    for (const voice of live) {
      const newMix = this.ctx.createGain();
      newMix.gain.setValueAtTime(0, now);
      newMix.gain.linearRampToValueAtTime(1, now + fade);
      newMix.connect(voice.env);

      const newOsc = this.ctx.createOscillator();
      newOsc.setPeriodicWave(wave);
      newOsc.frequency.setValueAtTime(voice.freq, now);
      newOsc.connect(newMix);
      newOsc.start(now);

      const oldOsc = voice.osc;
      const oldMix = voice.mix;
      oldMix.gain.cancelScheduledValues(now);
      oldMix.gain.setValueAtTime(Math.max(0, oldMix.gain.value), now);
      oldMix.gain.linearRampToValueAtTime(0, now + fade);
      try {
        oldOsc.stop(now + fade + 0.01);
      } catch {
        /* already stopped */
      }
      oldOsc.onended = () => {
        try {
          oldOsc.disconnect();
          oldMix.disconnect();
        } catch {
          /* already gone */
        }
      };

      voice.osc = newOsc;
      voice.mix = newMix;
    }
  }

  private releaseVoice(voice: Voice) {
    if (!this.ctx) return;
    voice.releasing = true;
    const now = this.ctx.currentTime;
    const release = Math.max(MIN_RELEASE, this.params.release);
    const env = voice.env.gain;
    env.cancelScheduledValues(now);
    const current = Math.max(0.0001, env.value);
    env.setValueAtTime(current, now);
    env.exponentialRampToValueAtTime(0.0001, now + release);
    try {
      voice.osc.stop(now + release + 0.03);
    } catch {
      /* already stopped */
    }
    const watch = voice;
    voice.osc.onended = () => this.finishVoice(watch);
    window.setTimeout(() => this.finishVoice(watch), (release + 0.08) * 1000);
    this.rebalance(now);
    this.emitVoices();
  }

  private fadeOut(voice: Voice, seconds: number) {
    if (!this.ctx) return;
    voice.releasing = true;
    const now = this.ctx.currentTime;
    voice.env.gain.cancelScheduledValues(now);
    voice.env.gain.setValueAtTime(Math.max(0.0001, voice.env.gain.value), now);
    voice.env.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    try {
      voice.osc.stop(now + seconds + 0.02);
    } catch {
      /* already stopped */
    }
    voice.osc.onended = () => this.disconnectVoice(voice);
    window.setTimeout(() => this.disconnectVoice(voice), (seconds + 0.08) * 1000);
  }

  private finishVoice(voice: Voice) {
    const current = this.voices.get(voice.midi);
    if (current === voice) this.voices.delete(voice.midi);
    this.disconnectVoice(voice);
    if (this.ctx) this.rebalance(this.ctx.currentTime);
    this.emitVoices();
  }

  private disconnectVoice(voice: Voice) {
    try {
      voice.osc.disconnect();
      voice.mix.disconnect();
      voice.env.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  private stealIfNeeded() {
    const held = [...this.voices.values()].filter((v) => !v.releasing);
    if (held.length < MAX_VOICES) return;
    held.sort((a, b) => a.born - b.born);
    const oldest = held[0];
    if (!oldest) return;
    this.voices.delete(oldest.midi);
    this.fadeOut(oldest, 0.012);
  }

  private rebalance(now: number) {
    if (!this.bus) return;
    const n = Math.max(
      1,
      [...this.voices.values()].filter((v) => !v.releasing).length,
    );
    const level = 0.9 / Math.sqrt(n);
    this.bus.gain.setTargetAtTime(level, now, 0.04);
  }

  private emitVoices() {
    const active = [...this.voices.values()]
      .filter((v) => !v.releasing)
      .map((v) => v.midi);
    this.voiceListeners.forEach((fn) => fn(active));
  }
}

export const synth = new SynthEngine();
