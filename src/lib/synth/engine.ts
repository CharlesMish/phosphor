import {
  HARMONIC_COUNT,
  normalizeWave,
  waveformToCoefficients,
} from "./waveform";
import { midiToHz } from "./keyboard-map";
import { SPACE_DEFAULT_SECONDS, buildSpaceBuffer } from "./space";
import { buildOutputSafetyCurve } from "./safety";
import {
  DRIVE_DEFAULT_AMOUNT,
  DRIVE_DEFAULT_SAFE,
  buildAppliedDriveCurve,
  clampDriveAmount,
  driveGuardGain,
  effectiveDriveAmount,
} from "./drive";
import {
  CHORUS_DEFAULT_PERIOD,
  CHORUS_MAX_MS,
  CHORUS_MIN_MS,
  buildChorusPeriodicWave,
  chorusMixGains,
} from "./chorus";

const MAX_VOICES = 12;
const VOICE_GAIN = 0.22;
const CROSSFADE = 0.02;
const SPACE_FADE = 0.07;
const WAVE_THROTTLE_MS = 32;
const MIN_ATTACK = 0.004;
const MIN_RELEASE = 0.03;
const CHORUS_FADE = 0.03;
const DRIVE_GUARD_FADE = 0.03;
const DRIVE_SAFE_RAMP_MS = 128;
const DRIVE_SAFE_RAMP_STEPS = 32;

export const DRIVE_DC_BLOCK_HZ = 10;
export const DRIVE_OVERSAMPLE: OverSampleType = "4x";

type SpaceSpec = {
  contour: number[];
  seed: number;
  metal: boolean;
  seconds: number;
};

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
  private drive: WaveShaperNode | null = null;
  private driveDcBlock: BiquadFilterNode | null = null;
  private driveGuard: GainNode | null = null;
  private bus: GainNode | null = null;
  private chorusDry: GainNode | null = null;
  private chorusWet: GainNode | null = null;
  private chorusSum: GainNode | null = null;
  private chorusDelayL: DelayNode | null = null;
  private chorusDelayR: DelayNode | null = null;
  private chorusLfoL: OscillatorNode | null = null;
  private chorusLfoR: OscillatorNode | null = null;
  private chorusBiasL: ConstantSourceNode | null = null;
  private chorusBiasR: ConstantSourceNode | null = null;
  private chorusPeriod = CHORUS_DEFAULT_PERIOD;
  private chorusCurve: number[] | null = null;
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
  private chorusMix = 0;
  private driveAuthoredCurve: number[] = [];
  private driveAmount = DRIVE_DEFAULT_AMOUNT;
  private driveSafe = DRIVE_DEFAULT_SAFE;
  private driveAppliedAmount = effectiveDriveAmount(
    DRIVE_DEFAULT_AMOUNT,
    DRIVE_DEFAULT_SAFE,
  );
  private driveCurve = buildAppliedDriveCurve([], this.driveAppliedAmount);
  private driveRampTimers: number[] = [];
  private driveRampVersion = 0;
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

  setChorusMix(mix: number) {
    this.chorusMix = Math.min(1, Math.max(0, mix));
    this.applyChorusMix();
  }

  setChorusPeriod(period: number) {
    this.chorusPeriod = Math.min(4, Math.max(0.25, period));
    const now = this.ctx?.currentTime ?? 0;
    this.chorusLfoL?.frequency.setTargetAtTime(1 / this.chorusPeriod, now, 0.02);
    this.chorusLfoR?.frequency.setTargetAtTime(1 / this.chorusPeriod, now, 0.02);
  }

  setChorusCurve(curve: number[]) {
    this.chorusCurve = curve.slice();
    if (!this.ctx || !this.chorusLfoL || !this.chorusLfoR) return;
    const leftSpec = buildChorusPeriodicWave(
      curve,
      Math.min(HARMONIC_COUNT, curve.length / 2),
    );
    const left = this.ctx.createPeriodicWave(
      leftSpec.real,
      leftSpec.imag,
      { disableNormalization: true },
    );
    // A half-cycle stereo shift multiplies every odd harmonic by -1. Derive it
    // directly so live drawing does not repeat the DFT and extrema proof.
    const rightReal = new Float32Array(leftSpec.real);
    const rightImag = new Float32Array(leftSpec.imag);
    for (let k = 1; k < rightReal.length; k += 2) {
      rightReal[k] = -(rightReal[k] ?? 0);
      rightImag[k] = -(rightImag[k] ?? 0);
    }
    const right = this.ctx.createPeriodicWave(
      rightReal,
      rightImag,
      { disableNormalization: true },
    );
    this.chorusLfoL.setPeriodicWave(left);
    this.chorusLfoR.setPeriodicWave(right);
    const now = this.ctx.currentTime;
    const midpoint = (CHORUS_MAX_MS + CHORUS_MIN_MS) / 2000;
    const depth = (CHORUS_MAX_MS - CHORUS_MIN_MS) / 2000;
    // PeriodicWave replacement is immediate, so its separately represented DC
    // bias must change at the same time. Easing only one half can temporarily
    // push the summed delay outside 8–24 ms.
    this.chorusBiasL?.offset.cancelScheduledValues(now);
    this.chorusBiasR?.offset.cancelScheduledValues(now);
    this.chorusBiasL?.offset.setValueAtTime(midpoint + leftSpec.bias * depth, now);
    this.chorusBiasR?.offset.setValueAtTime(midpoint + leftSpec.bias * depth, now);
  }

  setDriveCurve(authored: number[]) {
    this.setDriveState(authored, this.driveAmount, this.driveSafe);
  }

  /**
   * Applies playback parameters without changing the authored transfer.
   * `smoothAmount` is reserved for SAFE re-entry: WaveShaper.curve is not an
   * AudioParam, so the same single shaper receives a short sequence of derived
   * curves instead of introducing a latency-mismatched parallel dry path.
   */
  setDriveState(
    authored: number[],
    amount: number,
    safe: boolean,
    smoothAmount = false,
  ) {
    const targetAmount = effectiveDriveAmount(amount, safe);
    const previousAppliedAmount = this.driveAppliedAmount;
    const continueReduction =
      this.driveRampTimers.length > 0 && targetAmount < previousAppliedAmount;
    this.cancelDriveRamp();
    this.driveAuthoredCurve = authored.slice();
    this.driveAmount = safe ? targetAmount : clampDriveAmount(amount);
    this.driveSafe = safe;

    if (
      (smoothAmount || continueReduction) &&
      targetAmount < previousAppliedAmount &&
      this.ctx &&
      this.drive &&
      typeof window !== "undefined"
    ) {
      this.applyDriveAmount(previousAppliedAmount);
      const version = this.driveRampVersion;
      for (let step = 1; step <= DRIVE_SAFE_RAMP_STEPS; step++) {
        const timer = window.setTimeout(() => {
          if (version !== this.driveRampVersion) return;
          const progress = step / DRIVE_SAFE_RAMP_STEPS;
          const next =
            previousAppliedAmount +
            (targetAmount - previousAppliedAmount) * progress;
          this.applyDriveAmount(next);
          if (step === DRIVE_SAFE_RAMP_STEPS) this.driveRampTimers = [];
        }, (DRIVE_SAFE_RAMP_MS * step) / DRIVE_SAFE_RAMP_STEPS);
        this.driveRampTimers.push(timer);
      }
      return;
    }

    this.applyDriveAmount(targetAmount);
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
    this.cancelDriveRamp();
    if (this.waveTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.waveTimer);
    }
    if (this.spaceTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.spaceTimer);
    }
    this.waveTimer = null;
    this.spaceTimer = null;
    this.driveAppliedAmount = effectiveDriveAmount(
      this.driveAmount,
      this.driveSafe,
    );
    this.driveCurve = buildAppliedDriveCurve(
      this.driveAuthoredCurve,
      this.driveAppliedAmount,
    );
    try {
      this.chorusLfoL?.stop();
      this.chorusLfoR?.stop();
      this.chorusBiasL?.stop();
      this.chorusBiasR?.stop();
    } catch {
      /* already stopped */
    }
    this.pendingSpace = this.space;
    void this.ctx?.close();
    this.ctx = null;
    this.filter = null;
    this.drive = null;
    this.driveDcBlock = null;
    this.driveGuard = null;
    this.bus = null;
    this.chorusDry = null;
    this.chorusWet = null;
    this.chorusSum = null;
    this.chorusDelayL = null;
    this.chorusDelayR = null;
    this.chorusLfoL = null;
    this.chorusLfoR = null;
    this.chorusBiasL = null;
    this.chorusBiasR = null;
    this.dryGain = null;
    this.wetIn = null;
    this.convA = null;
    this.convB = null;
    this.wetA = null;
    this.wetB = null;
    this.sum = null;
    this.master = null;
    this.preSafetyAnalyser = null;
    this.safety = null;
    this.analyser = null;
    this.wave = null;
    this.spaceReady = false;
    this.spaceFadeUntil = 0;
    const wasReady = this.ready;
    this.ready = false;
    if (wasReady) this.readyListeners.forEach((fn) => fn(false));
  }

  private buildGraph() {
    if (!this.ctx) return;
    const ctx = this.ctx;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.7;
    filter.frequency.value = cutoffHz(this.params.cutoff);

    const drive = ctx.createWaveShaper();
    drive.curve = this.driveCurve;
    drive.oversample = DRIVE_OVERSAMPLE;

    const driveDcBlock = ctx.createBiquadFilter();
    driveDcBlock.type = "highpass";
    driveDcBlock.frequency.value = DRIVE_DC_BLOCK_HZ;
    driveDcBlock.Q.value = Math.SQRT1_2;

    // SAFE's deterministic, attenuation-only guard belongs to the DRIVE stage.
    // It sits after the 10 Hz DC blocker and before voice rebalance/CHORUS; the
    // separate final safety WaveShaper remains untouched at the output.
    const driveGuard = ctx.createGain();
    driveGuard.gain.value = driveGuardGain(this.driveCurve, this.driveSafe);

    const bus = ctx.createGain();
    bus.gain.value = 1;

    const chorusDry = ctx.createGain();
    const chorusWet = ctx.createGain();
    const initialChorusMix = chorusMixGains(this.chorusMix);
    chorusDry.gain.value = initialChorusMix.dry;
    chorusWet.gain.value = initialChorusMix.wet;
    const chorusDelayL = ctx.createDelay(0.1);
    const chorusDelayR = ctx.createDelay(0.1);
    // Modulation inputs sum with the intrinsic AudioParam value. Keep that
    // intrinsic value at zero so the 16 ms bias +/- 8 ms LFO is honestly 8-24 ms.
    chorusDelayL.delayTime.value = 0;
    chorusDelayR.delayTime.value = 0;
    const merger = ctx.createChannelMerger(2);
    const lfoL = ctx.createOscillator();
    const lfoR = ctx.createOscillator();
    lfoL.frequency.value = 1 / this.chorusPeriod;
    lfoR.frequency.value = 1 / this.chorusPeriod;
    const lfoGainL = ctx.createGain();
    const lfoGainR = ctx.createGain();
    lfoGainL.gain.value = (CHORUS_MAX_MS - CHORUS_MIN_MS) / 2000;
    lfoGainR.gain.value = (CHORUS_MAX_MS - CHORUS_MIN_MS) / 2000;
    const delayBiasL = ctx.createConstantSource();
    const delayBiasR = ctx.createConstantSource();
    delayBiasL.offset.value = (CHORUS_MAX_MS + CHORUS_MIN_MS) / 2000;
    delayBiasR.offset.value = (CHORUS_MAX_MS + CHORUS_MIN_MS) / 2000;
    lfoL.connect(lfoGainL).connect(chorusDelayL.delayTime);
    lfoR.connect(lfoGainR).connect(chorusDelayR.delayTime);
    delayBiasL.connect(chorusDelayL.delayTime);
    delayBiasR.connect(chorusDelayR.delayTime);
    bus.connect(chorusDry);
    bus.connect(chorusDelayL);
    bus.connect(chorusDelayR);
    chorusDelayL.connect(merger, 0, 0);
    chorusDelayR.connect(merger, 0, 1);
    const chorusSum = ctx.createGain();
    chorusDry.connect(chorusSum);
    merger.connect(chorusWet);
    chorusWet.connect(chorusSum);

    const dryGain = ctx.createGain();
    const wetIn = ctx.createGain();
    const initialSpaceMix = equalPower(this.spaceMix);
    dryGain.gain.value = initialSpaceMix.dry;
    wetIn.gain.value = initialSpaceMix.wet;
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

    filter.connect(drive);
    drive.connect(driveDcBlock);
    driveDcBlock.connect(driveGuard);
    driveGuard.connect(bus);
    chorusSum.connect(dryGain);
    chorusSum.connect(wetIn);
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
    this.drive = drive;
    this.driveDcBlock = driveDcBlock;
    this.driveGuard = driveGuard;
    this.bus = bus;
    this.chorusDry = chorusDry;
    this.chorusWet = chorusWet;
    this.chorusSum = chorusSum;
    this.chorusDelayL = chorusDelayL;
    this.chorusDelayR = chorusDelayR;
    this.chorusLfoL = lfoL;
    this.chorusLfoR = lfoR;
    this.chorusBiasL = delayBiasL;
    this.chorusBiasR = delayBiasR;
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
    this.applyChorusMix();
    if (this.chorusCurve) this.setChorusCurve(this.chorusCurve);
    else {
      lfoL.type = "sine";
      lfoR.type = "sine";
    }
    lfoL.start();
    lfoR.start();
    delayBiasL.start();
    delayBiasR.start();

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

  private applyChorusMix() {
    if (!this.chorusDry || !this.chorusWet) return;
    const now = this.ctx?.currentTime ?? 0;
    const { dry, wet } = chorusMixGains(this.chorusMix);
    this.chorusDry.gain.setTargetAtTime(dry, now, CHORUS_FADE);
    this.chorusWet.gain.setTargetAtTime(wet, now, CHORUS_FADE);
  }

  private applyDriveAmount(amount: number) {
    this.driveAppliedAmount = clampDriveAmount(amount);
    this.driveCurve = buildAppliedDriveCurve(
      this.driveAuthoredCurve,
      this.driveAppliedAmount,
    );
    if (this.drive) this.drive.curve = this.driveCurve;
    if (!this.driveGuard) return;
    const now = this.ctx?.currentTime ?? 0;
    const gain = driveGuardGain(this.driveCurve, this.driveSafe);
    this.driveGuard.gain.setTargetAtTime(gain, now, DRIVE_GUARD_FADE);
  }

  private cancelDriveRamp() {
    this.driveRampVersion += 1;
    if (typeof window !== "undefined") {
      for (const timer of this.driveRampTimers) window.clearTimeout(timer);
    }
    this.driveRampTimers = [];
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
