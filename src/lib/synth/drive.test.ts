import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRIVE_CURVE_SIZE,
  DRIVE_DEFAULT_AMOUNT,
  DRIVE_DEFAULT_SAFE,
  DRIVE_SAFE_MAX_AMOUNT,
  buildAppliedDriveCurve,
  buildDriveCurve,
  clampDriveAmount,
  driveGuardGain,
  effectiveDriveAmount,
  generateDrivePreset,
  sampleTransfer,
} from "./drive.ts";
import {
  CYCLE_MORPH_RAMP_SECONDS,
  CURVE_UPDATE_INTERVAL_MS,
  DRIVE_DC_BLOCK_HZ,
  DRIVE_OVERSAMPLE,
  MAX_VOICES,
  OSCILLATOR_SAMPLE_TARGET,
  SynthEngine,
  VOICE_GAIN,
  cycleMorphSamples,
  phaseAlignedPreDrivePeak,
  voiceRebalanceGain,
} from "./engine.ts";
import { useSynthStore } from "./store.ts";
import {
  generatePreset,
  invertWave,
  lerpWaves,
  normalizeWave,
  peakOf,
  waveformToCoefficients,
} from "./waveform.ts";
import { chorusMixGains, generateChorusPreset } from "./chorus.ts";
import { generateSpaceContour } from "./space.ts";

class TestAudioParam {
  value = 0;
  readonly setValueCalls: number[] = [];
  readonly holdCalls: number[] = [];
  readonly linearRampCalls: Array<{
    prior: number;
    value: number;
    endTime: number;
  }> = [];
  readonly targetCalls: Array<{
    prior: number;
    value: number;
    timeConstant: number;
  }> = [];

  setValueAtTime(value: number) {
    this.setValueCalls.push(value);
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, endTime = 0) {
    this.linearRampCalls.push({ prior: this.value, value, endTime });
    this.value = value;
    return this;
  }

  exponentialRampToValueAtTime(value: number) {
    this.value = value;
    return this;
  }

  setTargetAtTime(value: number, _startTime?: number, timeConstant = 0) {
    this.targetCalls.push({ prior: this.value, value, timeConstant });
    this.value = value;
    return this;
  }

  cancelScheduledValues() {
    return this;
  }

  cancelAndHoldAtTime(time: number) {
    this.holdCalls.push(time);
    return this;
  }
}

type TestConnection = TestAudioNode | TestAudioParam;

class TestAudioNode {
  readonly connections: TestConnection[] = [];
  readonly connectionDetails: Array<{
    target: TestConnection;
    output?: number;
    input?: number;
  }> = [];

  connect<T extends TestConnection>(target: T, output?: number, input?: number): T {
    this.connections.push(target);
    this.connectionDetails.push({ target, output, input });
    return target;
  }

  disconnect() {
    this.connections.length = 0;
    this.connectionDetails.length = 0;
  }
}

class TestGainNode extends TestAudioNode {
  readonly gain = new TestAudioParam();
}

class TestFilterNode extends TestAudioNode {
  type: BiquadFilterType = "lowpass";
  readonly Q = new TestAudioParam();
  readonly frequency = new TestAudioParam();
}

class TestWaveShaperNode extends TestAudioNode {
  private currentCurve: Float32Array<ArrayBuffer> | null = null;
  readonly curveAssignments: Float32Array<ArrayBuffer>[] = [];
  oversample: OverSampleType = "none";

  get curve() {
    return this.currentCurve;
  }

  set curve(curve: Float32Array<ArrayBuffer> | null) {
    this.currentCurve = curve;
    if (curve) this.curveAssignments.push(new Float32Array(curve));
  }
}

class TestConvolverNode extends TestAudioNode {
  normalize = true;
  buffer: AudioBuffer | null = null;
}

class TestDelayNode extends TestAudioNode {
  readonly delayTime = new TestAudioParam();
}

class TestChannelMergerNode extends TestAudioNode {}

class TestConstantSourceNode extends TestAudioNode {
  readonly offset = new TestAudioParam();
  started = false;
  stopped = false;

  start() {
    this.started = true;
  }

  stop() {
    this.stopped = true;
  }
}

class TestAnalyserNode extends TestAudioNode {
  fftSize = 2048;
  smoothingTimeConstant = 0;
  private samples: number[] = [];

  setSamples(samples: number[]) {
    this.samples = samples.slice();
  }

  getFloatTimeDomainData(data: Float32Array) {
    for (let i = 0; i < data.length; i++) data[i] = this.samples[i] ?? 0;
  }
}

class TestOscillatorNode extends TestAudioNode {
  readonly frequency = new TestAudioParam();
  type: OscillatorType = "sine";
  onended: (() => void) | null = null;
  wave: PeriodicWave | null = null;
  started = false;
  stopped = false;
  readonly startTimes: number[] = [];
  readonly stopTimes: number[] = [];

  setPeriodicWave(wave: PeriodicWave) {
    this.wave = wave;
  }

  start(when = 0) {
    this.started = true;
    this.startTimes.push(when);
  }

  stop(when = 0) {
    this.stopped = true;
    this.stopTimes.push(when);
  }
}

type TestPeriodicWave = {
  real: Float32Array;
  imag: Float32Array;
  disableNormalization: boolean;
};

class TestAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array<ArrayBuffer>[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }

  getChannelData(channel: number): Float32Array<ArrayBuffer> {
    const data = this.channels[channel];
    if (!data) throw new RangeError(`missing channel ${channel}`);
    return data;
  }
}

class TestAudioContext {
  static last: TestAudioContext | null = null;
  readonly currentTime = 0;
  readonly sampleRate = 48000;
  readonly state: AudioContextState = "running";
  readonly destination = new TestAudioNode();
  readonly filters: TestFilterNode[] = [];
  readonly shapers: TestWaveShaperNode[] = [];
  readonly convolvers: TestConvolverNode[] = [];
  readonly delays: TestDelayNode[] = [];
  readonly mergers: TestChannelMergerNode[] = [];
  readonly constantSources: TestConstantSourceNode[] = [];
  readonly gains: TestGainNode[] = [];
  readonly oscillators: TestOscillatorNode[] = [];
  readonly periodicWaves: TestPeriodicWave[] = [];
  readonly analysers: TestAnalyserNode[] = [];
  closed = false;

  constructor() {
    TestAudioContext.last = this;
  }

  createBiquadFilter() {
    const node = new TestFilterNode();
    this.filters.push(node);
    return node;
  }

  createWaveShaper() {
    const node = new TestWaveShaperNode();
    this.shapers.push(node);
    return node;
  }

  createGain() {
    const node = new TestGainNode();
    this.gains.push(node);
    return node;
  }

  createConvolver() {
    const node = new TestConvolverNode();
    this.convolvers.push(node);
    return node;
  }

  createDelay() {
    const node = new TestDelayNode();
    this.delays.push(node);
    return node;
  }

  createChannelMerger() {
    const node = new TestChannelMergerNode();
    this.mergers.push(node);
    return node;
  }

  createConstantSource() {
    const node = new TestConstantSourceNode();
    this.constantSources.push(node);
    return node;
  }

  createAnalyser() {
    const node = new TestAnalyserNode();
    this.analysers.push(node);
    return node;
  }

  createOscillator() {
    const node = new TestOscillatorNode();
    this.oscillators.push(node);
    return node;
  }

  createPeriodicWave(
    real: Float32Array,
    imag: Float32Array,
    options?: PeriodicWaveConstraints,
  ) {
    const wave = {
      real: new Float32Array(real),
      imag: new Float32Array(imag),
      disableNormalization: options?.disableNormalization ?? false,
    };
    this.periodicWaves.push(wave);
    return wave as unknown as PeriodicWave;
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    return new TestAudioBuffer(channels, length, sampleRate);
  }

  resume() {
    return Promise.resolve();
  }

  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

function periodicValue(wave: TestPeriodicWave, phase: number): number {
  let value = 0;
  for (let k = 1; k < wave.real.length; k++) {
    const angle = 2 * Math.PI * k * phase;
    value +=
      (wave.real[k] ?? 0) * Math.cos(angle) +
      (wave.imag[k] ?? 0) * Math.sin(angle);
  }
  return value;
}

function conditionedPeriodicPeak(samples: number[], probeCount = 8192): number {
  const conditioned = normalizeWave(samples, OSCILLATOR_SAMPLE_TARGET);
  const { real, imag } = waveformToCoefficients(conditioned);
  const wave: TestPeriodicWave = { real, imag, disableNormalization: true };
  let peak = 0;
  for (let i = 0; i < probeCount; i++) {
    peak = Math.max(peak, Math.abs(periodicValue(wave, i / probeCount)));
  }
  return peak;
}

function withTestEngine(
  run: (
    engine: SynthEngine,
    context: TestAudioContext,
    timers: Map<number, { callback: () => void; delay: number }>,
  ) => void,
) {
  const originalAudioContext = globalThis.AudioContext;
  const originalWindow = globalThis.window;
  let nextTimer = 1;
  const timers = new Map<
    number,
    { callback: () => void; delay: number }
  >();
  const engine = new SynthEngine();
  Object.assign(globalThis, {
    AudioContext: TestAudioContext,
    window: {
      setTimeout: (callback: () => void, delay = 0) => {
        const id = nextTimer++;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id: number) => timers.delete(id),
    },
  });

  try {
    engine.unlock();
    const context = TestAudioContext.last;
    assert.ok(context);
    run(engine, context, timers);
  } finally {
    engine.dispose();
    Object.assign(globalThis, {
      AudioContext: originalAudioContext,
      window: originalWindow,
    });
  }
}

function assertSamplesNear(actual: number[], expected: number[], epsilon = 1e-12) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index++) {
    assert.ok(
      Math.abs((actual[index] ?? 0) - (expected[index] ?? 0)) < epsilon,
      `sample ${index}: ${actual[index]} versus ${expected[index]}`,
    );
  }
}

describe("DRIVE transfer curve", () => {
  it("makes the default curve effectively identity", () => {
    const curve = buildDriveCurve(generateDrivePreset("identity"));
    assert.equal(curve.length, DRIVE_CURVE_SIZE);
    for (let i = 0; i < curve.length; i++) {
      const input = (i / (curve.length - 1)) * 2 - 1;
      assert.ok(Math.abs((curve[i] ?? 0) - input) < 1e-6, `${input} -> ${curve[i]}`);
    }
  });

  it("linearly interpolates authored points without wrapping", () => {
    const authored = [-1, 0.5, 1];
    assert.equal(sampleTransfer(authored, -1), -1);
    assert.equal(sampleTransfer(authored, -0.5), -0.25);
    assert.equal(sampleTransfer(authored, 0), 0.5);
    assert.equal(sampleTransfer(authored, 0.5), 0.75);
    assert.equal(sampleTransfer(authored, 1), 1);
  });

  it("bounds invalid and out-of-range authored output", () => {
    const curve = buildDriveCurve([-4, Number.NaN, 6], 129);
    for (const value of curve) {
      assert.ok(Number.isFinite(value));
      assert.ok(value >= -1 && value <= 1);
    }
    assert.equal(curve[0], -1);
    assert.equal(curve[curve.length - 1], 1);
  });

  it("preserves genuinely asymmetric transfer functions", () => {
    const authored = generateDrivePreset("asym");
    const curve = buildDriveCurve(authored);
    const negative = sampleTransfer(curve, -0.5);
    const positive = sampleTransfer(curve, 0.5);
    assert.ok(Math.abs(positive + negative) > 0.1, `${negative}, ${positive}`);
    assert.ok(Math.abs(sampleTransfer(curve, 0)) < 1e-12);
  });

  it("does not force an authored zero-input offset back to zero", () => {
    const authored = generateDrivePreset("identity");
    authored[Math.floor(authored.length / 2)] = 0.37;
    const curve = buildDriveCurve(authored);
    assert.ok(Math.abs(sampleTransfer(curve, 0) - 0.37) < 1e-6);
  });
});

describe("DRIVE conservative audition", () => {
  it("defines the conservative Amount and SAFE defaults", () => {
    assert.equal(DRIVE_DEFAULT_AMOUNT, 0.25);
    assert.equal(DRIVE_DEFAULT_SAFE, true);
    assert.equal(DRIVE_SAFE_MAX_AMOUNT, 0.25);
  });

  it("clamps Amount to its physical range and SAFE to its audition ceiling", () => {
    assert.equal(clampDriveAmount(-0.2), 0);
    assert.equal(clampDriveAmount(0.4), 0.4);
    assert.equal(clampDriveAmount(1.2), 1);
    assert.equal(effectiveDriveAmount(0.9, true), DRIVE_SAFE_MAX_AMOUNT);
    assert.equal(effectiveDriveAmount(0.9, false), 0.9);
  });

  it("makes zero Amount exact identity regardless of the authored transfer", () => {
    const identity = buildDriveCurve(generateDrivePreset("identity"));
    for (const preset of ["soft", "hard", "asym"] as const) {
      assert.deepEqual(
        buildAppliedDriveCurve(generateDrivePreset(preset), 0),
        identity,
      );
    }

    const custom = generateDrivePreset("hard");
    custom[Math.floor(custom.length / 2)] = 0.73;
    assert.deepEqual(buildAppliedDriveCurve(custom, 0), identity);
  });

  it("makes full Amount exactly the authored transfer", () => {
    for (const preset of ["identity", "soft", "hard", "asym"] as const) {
      const authored = generateDrivePreset(preset);
      assert.deepEqual(
        buildAppliedDriveCurve(authored, 1),
        buildDriveCurve(authored),
      );
    }
  });

  it("keeps authored Identity exact at every Amount", () => {
    const authored = generateDrivePreset("identity");
    const identity = buildDriveCurve(authored);
    for (const amount of [0, 0.123, 0.25, 0.73, 1]) {
      assert.deepEqual(buildAppliedDriveCurve(authored, amount), identity);
    }
  });

  it("keeps 1, 4, 6, and 12 reconstructed preset voices inside DRIVE's input domain", () => {
    const identity = buildAppliedDriveCurve(generateDrivePreset("hard"), 0);
    const oscillatorPeak = Math.max(
      ...(["sine", "triangle", "saw", "square"] as const).map((preset) =>
        conditionedPeriodicPeak(generatePreset(preset)),
      ),
    );
    assert.ok(
      oscillatorPeak > OSCILLATOR_SAMPLE_TARGET,
      "the probe must include reconstruction overshoot, not just sample peaks",
    );
    for (const voices of [1, 4, 6, 12]) {
      const expectedGain = 0.9 / Math.sqrt(voices);
      assert.equal(voiceRebalanceGain(voices), expectedGain);

      const summedBeforeRebalance = voices * oscillatorPeak * VOICE_GAIN;
      const baseline = summedBeforeRebalance * expectedGain;
      const preDrivePeak = phaseAlignedPreDrivePeak(voices, oscillatorPeak);
      assert.ok(Math.abs(preDrivePeak - baseline) < 1e-12);
      assert.ok(preDrivePeak < 1, `${voices} voices peak at ${preDrivePeak}`);
      assert.ok(
        Math.abs(sampleTransfer(identity, preDrivePeak) - baseline) < 1e-6,
        `Amount 0 changed the ${voices}-voice baseline`,
      );
    }
    assert.equal(MAX_VOICES, 12);
  });

  it("uses an attenuation-only deterministic RMS guard", () => {
    const identity = buildAppliedDriveCurve(generateDrivePreset("identity"), 0.25);
    assert.equal(driveGuardGain(identity, true), 1);

    const quiet = buildAppliedDriveCurve(new Array(257).fill(0), 1);
    assert.equal(driveGuardGain(quiet, true), 1, "the guard must not add makeup gain");

    const hard = buildAppliedDriveCurve(generateDrivePreset("hard"), 0.25);
    const hardGuard = driveGuardGain(hard, true);
    assert.ok(hardGuard > 0 && hardGuard < 1, `${hardGuard}`);
    assert.equal(driveGuardGain(hard, false), 1);

    let identityEnergy = 0;
    let effectiveEnergy = 0;
    for (let i = 0; i < hard.length; i++) {
      const input = (i / (hard.length - 1)) * 2 - 1;
      identityEnergy += input * input;
      effectiveEnergy += (hard[i] ?? 0) ** 2;
    }
    const expected = Math.min(1, Math.sqrt(identityEnergy / effectiveEnergy));
    assert.ok(Math.abs(hardGuard - expected) < 1e-12);

    for (const preset of ["identity", "soft", "hard", "asym"] as const) {
      for (const amount of [0, 0.1, 0.25, 0.7, 1]) {
        const gain = driveGuardGain(
          buildAppliedDriveCurve(generateDrivePreset(preset), amount),
          true,
        );
        assert.ok(Number.isFinite(gain));
        assert.ok(gain > 0 && gain <= 1, `${preset} ${amount}: ${gain}`);
      }
    }
  });
});

describe("CYCLE morph normalization diagnosis", () => {
  it("keeps identical endpoints invariant at every morph value", () => {
    const sine = generatePreset("sine");
    const conditioned = normalizeWave(sine, OSCILLATOR_SAMPLE_TARGET);
    for (const value of [0, 0.01, 0.35, 0.5, 0.83, 1]) {
      assert.deepEqual(cycleMorphSamples(sine, sine, value), conditioned);
    }
  });

  it("preserves an honest linear sine to inverted-sine cancellation", () => {
    const sine = generatePreset("sine");
    const inverted = invertWave(sine);
    const cases = [
      { value: 0.1, honestPeak: 0.72 },
      { value: 0.25, honestPeak: 0.45 },
      { value: 0.49, honestPeak: 0.018 },
      { value: 0.5, honestPeak: 0 },
    ];

    for (const { value, honestPeak } of cases) {
      const rawBlend = lerpWaves(sine, inverted, value);
      const legacyFirstPass = normalizeWave(rawBlend, 0.92);
      const legacyEnginePass = normalizeWave(
        legacyFirstPass,
        OSCILLATOR_SAMPLE_TARGET,
      );
      const honest = cycleMorphSamples(sine, inverted, value);

      assert.ok(Math.abs(peakOf(honest) - honestPeak) < 1e-12);
      if (value === 0.5) {
        assert.equal(peakOf(legacyEnginePass), 0);
      } else {
        assert.ok(Math.abs(peakOf(legacyFirstPass) - 0.92) < 1e-12);
        assert.ok(
          Math.abs(peakOf(legacyEnginePass) - OSCILLATOR_SAMPLE_TARGET) <
            1e-12,
        );
      }
    }
  });

  it("linearly interpolates similar sine and triangle-derived endpoints", () => {
    const sine = generatePreset("sine");
    const nearSine = sine.map(
      (value, index) =>
        value + 0.015 * Math.sin((4 * Math.PI * index) / sine.length),
    );
    const triangle = generatePreset("triangle");
    const nearTriangle = triangle.map(
      (value, index) =>
        value + 0.01 * Math.sin((6 * Math.PI * index) / triangle.length),
    );

    for (const [a, b] of [
      [sine, nearSine],
      [triangle, nearTriangle],
    ]) {
      const conditionedA = normalizeWave(a, OSCILLATOR_SAMPLE_TARGET);
      const conditionedB = normalizeWave(b, OSCILLATOR_SAMPLE_TARGET);
      assertSamplesNear(
        cycleMorphSamples(a, b, 0.5),
        lerpWaves(conditionedA, conditionedB, 0.5),
      );
    }
  });
});

describe("phase-coherent CYCLE morph runtime", () => {
  it("characterizes the former generic waveform path as structural per frame", () => {
    withTestEngine((engine, context) => {
      const sine = generatePreset("sine");
      engine.setWaveform(sine, true);
      engine.noteOn(60);
      const before = context.oscillators.length;
      engine.setWaveform(sine, true);
      engine.setWaveform(sine, true);
      assert.equal(
        context.oscillators.length,
        before + 2,
        "even identical generic updates replace the held oscillator",
      );
    });
  });

  it("does not churn oscillators or wave tables for identical A/B Motion", () => {
    withTestEngine((engine, context) => {
      const sine = generatePreset("sine");
      engine.setCycleMorph(sine, sine, 0);
      engine.noteOn(60);
      const oscillatorCount = context.oscillators.length;
      const waveCount = context.periodicWaves.length;
      assert.equal(oscillatorCount, 4, "two Chorus LFOs plus one A/B pair");
      const oscA = context.oscillators[2];
      const oscB = context.oscillators[3];
      assert.ok(oscA);
      assert.ok(oscB);
      assert.deepEqual(oscA.startTimes, oscB.startTimes);
      assert.equal(
        oscA.wave,
        oscB.wave,
        "identical endpoints share one wave table",
      );

      for (const value of [0.1, 0.8, 0.35, 1, 0.02]) {
        engine.setCycleMorph(sine, sine, value);
      }
      assert.equal(context.oscillators.length, oscillatorCount);
      assert.equal(context.periodicWaves.length, waveCount);
      const gainA = oscA.connections[0];
      const gainB = oscB.connections[0];
      assert.ok(gainA instanceof TestGainNode);
      assert.ok(gainB instanceof TestGainNode);
      assert.ok(Math.abs(gainA.gain.value + gainB.gain.value - 1) < 1e-12);
      assert.deepEqual(
        cycleMorphSamples(sine, sine, 0.02),
        normalizeWave(sine, OSCILLATOR_SAMPLE_TARGET),
      );
    });
  });

  it("uses one phase-locked pair and smooth gains for nearly-identical A/B", () => {
    withTestEngine((engine, context) => {
      const sine = generatePreset("sine");
      const nearby = sine.map(
        (value, index) =>
          value + 0.01 * Math.sin((4 * Math.PI * index) / sine.length),
      );
      engine.setCycleMorph(sine, nearby, 0.2);
      engine.noteOn(64);
      const oscillatorCount = context.oscillators.length;
      const waveCount = context.periodicWaves.length;
      const oscA = context.oscillators[2];
      const oscB = context.oscillators[3];
      assert.ok(oscA);
      assert.ok(oscB);
      assert.deepEqual(oscA.startTimes, oscB.startTimes);
      const gainA = oscA.connections[0];
      const gainB = oscB.connections[0];
      assert.ok(gainA instanceof TestGainNode);
      assert.ok(gainB instanceof TestGainNode);

      engine.setCycleMorph(sine, nearby, 0.23);
      engine.setCycleMorph(sine, nearby, 0.18);
      assert.equal(context.oscillators.length, oscillatorCount);
      assert.equal(context.periodicWaves.length, waveCount);
      assert.ok(
        Math.abs((gainA.gain.linearRampCalls.at(-1)?.value ?? 0) - 0.82) <
          1e-12,
      );
      assert.equal(gainB.gain.linearRampCalls.at(-1)?.value, 0.18);
      assert.equal(
        gainA.gain.linearRampCalls.at(-1)?.endTime,
        CYCLE_MORPH_RAMP_SECONDS,
      );
      assert.equal(
        gainB.gain.linearRampCalls.at(-1)?.endTime,
        CYCLE_MORPH_RAMP_SECONDS,
      );
    });
  });

  it("makes one click-safe structural transition for an already-held note", () => {
    withTestEngine((engine, context) => {
      const sine = generatePreset("sine");
      const triangle = generatePreset("triangle");
      engine.setWaveform(sine, true);
      engine.noteOn(60);
      const original = context.oscillators[2];
      assert.ok(original);
      assert.equal(context.oscillators.length, 3);

      engine.setCycleMorph(sine, triangle, 0.25);
      assert.equal(context.oscillators.length, 5);
      assert.equal(original.stopped, true);
      const pairCount = context.oscillators.length;
      const waveCount = context.periodicWaves.length;

      for (const value of [0.28, 0.31, 0.2, 0.9]) {
        engine.setCycleMorph(sine, triangle, value);
      }
      assert.equal(context.oscillators.length, pairCount);
      assert.equal(context.periodicWaves.length, waveCount);
    });
  });

  it("keeps direct CYCLE drawing on its established single-wave transition", () => {
    withTestEngine((engine, context) => {
      engine.setWaveform(generatePreset("sine"), true);
      engine.noteOn(60);
      const before = context.oscillators.length;
      engine.setWaveform(generatePreset("triangle"), true);
      assert.equal(context.oscillators.length, before + 1);
      assert.equal(context.oscillators[2]?.stopped, true);
    });
  });

  it("returns a held morph pair to one direct-CYCLE oscillator in one transition", () => {
    withTestEngine((engine, context) => {
      engine.setCycleMorph(
        generatePreset("sine"),
        generatePreset("triangle"),
        0.4,
      );
      engine.noteOn(60);
      const pairA = context.oscillators[2];
      const pairB = context.oscillators[3];
      assert.ok(pairA);
      assert.ok(pairB);

      engine.setWaveform(generatePreset("saw"), true);
      assert.equal(context.oscillators.length, 5);
      assert.equal(pairA.stopped, true);
      assert.equal(pairB.stopped, true);
      const direct = context.oscillators[4];
      assert.ok(direct);
      assert.equal(direct.stopped, false);
    });
  });

  it("bounds 12-voice pair lifecycle through release and stealing", () => {
    withTestEngine((engine, context) => {
      const voiceEvents: number[][] = [];
      engine.onVoices((notes) => voiceEvents.push(notes));
      engine.setCycleMorph(
        generatePreset("sine"),
        generatePreset("triangle"),
        0.35,
      );
      for (let midi = 60; midi < 60 + MAX_VOICES; midi++) engine.noteOn(midi);
      assert.equal(voiceEvents.at(-1)?.length, MAX_VOICES);
      assert.equal(
        context.oscillators.filter((oscillator) => !oscillator.stopped).length,
        2 + MAX_VOICES * 2,
      );

      engine.noteOn(72);
      assert.equal(voiceEvents.at(-1)?.length, MAX_VOICES);
      assert.equal(context.oscillators.length, 2 + (MAX_VOICES + 1) * 2);
      assert.equal(
        context.oscillators.filter((oscillator) => !oscillator.stopped).length,
        2 + MAX_VOICES * 2,
      );

      const releasedA = context.oscillators.at(-2);
      const releasedB = context.oscillators.at(-1);
      const gainA = releasedA?.connections[0];
      const gainB = releasedB?.connections[0];
      assert.ok(releasedA);
      assert.ok(releasedB);
      assert.ok(gainA instanceof TestGainNode);
      assert.ok(gainB instanceof TestGainNode);
      const mix = gainA.connections[0];
      assert.ok(mix instanceof TestGainNode);
      const env = mix.connections[0];
      assert.ok(env instanceof TestGainNode);

      engine.noteOff(72);
      assert.equal(voiceEvents.at(-1)?.length, MAX_VOICES - 1);
      assert.equal(releasedA.stopped, true);
      assert.equal(releasedB.stopped, true);
      releasedA.onended?.();
      assert.ok(releasedB.connections.length > 0);
      releasedB.onended?.();
      assert.equal(releasedA.connections.length, 0);
      assert.equal(releasedB.connections.length, 0);
      assert.equal(gainA.connections.length, 0);
      assert.equal(gainB.connections.length, 0);
      assert.equal(mix.connections.length, 0);
      assert.equal(env.connections.length, 0);

      engine.allNotesOff();
      assert.deepEqual(voiceEvents.at(-1), []);
      assert.equal(
        context.oscillators.filter((oscillator) => !oscillator.stopped).length,
        2,
        "only the two Chorus LFOs remain scheduled",
      );
    });
  });
});

describe("DRIVE history", () => {
  it("records one gesture as one isolated undo/redo step", () => {
    const before = generateDrivePreset("identity");
    const after = generateDrivePreset("hard");
    const cycleHistory = [generatePreset("triangle")];
    const spaceHistory = [{
      contour: [0, 1],
      seed: 7,
      preset: "custom" as const,
      metal: false,
    }];
    useSynthStore.setState({
      domain: "drive",
      driveCurve: before,
      drivePreset: "identity",
      drivePast: [],
      driveFuture: [],
      past: cycleHistory,
      spacePast: spaceHistory,
    });

    useSynthStore.getState().setLiveDrive(after);
    useSynthStore.getState().finishDriveGesture(before, after);
    assert.equal(useSynthStore.getState().drivePast.length, 1);
    assert.equal(useSynthStore.getState().past, cycleHistory);
    assert.equal(useSynthStore.getState().spacePast, spaceHistory);

    useSynthStore.getState().undo();
    assert.deepEqual(useSynthStore.getState().driveCurve, before);
    assert.equal(useSynthStore.getState().drivePreset, "identity");
    assert.equal(useSynthStore.getState().driveFuture.length, 1);

    useSynthStore.getState().redo();
    assert.deepEqual(useSynthStore.getState().driveCurve, after);
    assert.equal(useSynthStore.getState().drivePreset, "custom");
    assert.equal(useSynthStore.getState().drivePast.length, 1);
  });
});

describe("combined live audio graph", () => {
  it("drops rebalance gain immediately for rapid note additions and recovers smoothly", () => {
    const originalAudioContext = globalThis.AudioContext;
    const originalWindow = globalThis.window;
    let nextTimer = 1;
    const timers = new Map<number, () => void>();
    let engine: SynthEngine | null = null;
    Object.assign(globalThis, {
      AudioContext: TestAudioContext,
      window: {
        setTimeout: (callback: () => void) => {
          const id = nextTimer++;
          timers.set(id, callback);
          return id;
        },
        clearTimeout: (id: number) => timers.delete(id),
      },
    });

    try {
      engine = new SynthEngine();
      engine.setWaveform(generatePreset("sine"), true);
      const checkpoints = new Set([1, 4, 6, 12]);
      let bus: TestGainNode | null = null;
      for (let voices = 1; voices <= MAX_VOICES; voices++) {
        engine.noteOn(59 + voices);
        const context = TestAudioContext.last;
        assert.ok(context);
        const lowPass = context.filters[0];
        assert.ok(lowPass);
        const candidate = lowPass.connections[0];
        assert.ok(candidate instanceof TestGainNode);
        bus = candidate;
        if (checkpoints.has(voices)) {
          assert.equal(bus.gain.setValueCalls.at(-1), voiceRebalanceGain(voices));
          assert.equal(
            bus.gain.targetCalls.length,
            0,
            `${voices}-voice attack must not use the 40 ms recovery path`,
          );
        }
      }
      assert.ok(bus);

      engine.noteOff(70);
      assert.equal(
        bus.gain.targetCalls.length,
        0,
        "an audible release tail must keep its pre-DRIVE headroom",
      );
      const releasedOscillator = TestAudioContext.last?.oscillators[12];
      assert.ok(releasedOscillator?.onended);
      releasedOscillator.onended();
      assert.equal(bus.gain.holdCalls.at(-1), 0);
      assert.equal(bus.gain.targetCalls.at(-1)?.value, voiceRebalanceGain(11));
      assert.equal(bus.gain.targetCalls.at(-1)?.timeConstant, 0.04);

      const immediateCalls = bus.gain.setValueCalls.length;
      const recoveryCalls = bus.gain.targetCalls.length;
      engine.noteOn(84);
      assert.equal(bus.gain.setValueCalls.length, immediateCalls + 1);
      assert.equal(bus.gain.setValueCalls.at(-1), voiceRebalanceGain(12));
      assert.equal(
        bus.gain.targetCalls.length,
        recoveryCalls,
        "a rapid re-add must cancel recovery and restore headroom immediately",
      );
    } finally {
      engine?.dispose();
      Object.assign(globalThis, {
        AudioContext: originalAudioContext,
        window: originalWindow,
      });
    }
  });

  it("coalesces live DRIVE tables near the CYCLE cadence and commits immediately", () => {
    const originalAudioContext = globalThis.AudioContext;
    const originalWindow = globalThis.window;
    let nextTimer = 1;
    const timers = new Map<number, { callback: () => void; delay: number }>();
    let engine: SynthEngine | null = null;
    Object.assign(globalThis, {
      AudioContext: TestAudioContext,
      window: {
        setTimeout: (callback: () => void, delay = 0) => {
          const id = nextTimer++;
          timers.set(id, { callback, delay });
          return id;
        },
        clearTimeout: (id: number) => timers.delete(id),
      },
    });

    try {
      engine = new SynthEngine();
      engine.unlock();
      const context = TestAudioContext.last;
      assert.ok(context);
      const drive = context.shapers[0];
      assert.ok(drive);

      engine.setDriveCurve(generateDrivePreset("identity"), true);
      const beforeLive = drive.curveAssignments.length;
      engine.setDriveCurve(generateDrivePreset("soft"), false);
      engine.setDriveCurve(generateDrivePreset("hard"), false);
      engine.setDriveCurve(generateDrivePreset("asym"), false);
      assert.equal(drive.curveAssignments.length, beforeLive);
      assert.equal(timers.size, 1);
      const queued = [...timers.entries()][0];
      assert.ok(queued);
      assert.ok(
        queued[1].delay > 0 &&
          queued[1].delay <= CURVE_UPDATE_INTERVAL_MS,
      );
      timers.delete(queued[0]);
      queued[1].callback();
      assert.equal(drive.curveAssignments.length, beforeLive + 1);
      assert.deepEqual(
        drive.curve,
        buildAppliedDriveCurve(generateDrivePreset("asym"), DRIVE_DEFAULT_AMOUNT),
      );

      engine.setDriveCurve(generateDrivePreset("soft"), false);
      engine.setDriveCurve(generateDrivePreset("hard"), false);
      assert.equal(timers.size, 1);
      const beforeCommit = drive.curveAssignments.length;
      engine.setDriveCurve(generateDrivePreset("hard"), true);
      assert.equal(timers.size, 0);
      assert.equal(drive.curveAssignments.length, beforeCommit + 1);
      assert.deepEqual(
        drive.curve,
        buildAppliedDriveCurve(generateDrivePreset("hard"), DRIVE_DEFAULT_AMOUNT),
      );
    } finally {
      engine?.dispose();
      Object.assign(globalThis, {
        AudioContext: originalAudioContext,
        window: originalWindow,
      });
    }
  });

  it("orders DRIVE, CHORUS, SPACE, and final safety without replacing a held note", () => {
    const originalAudioContext = globalThis.AudioContext;
    const originalWindow = globalThis.window;
    let engine: SynthEngine | null = null;
    let nextTimer = 1;
    let timerCalls = 0;
    const timers = new Map<number, () => void>();
    Object.assign(globalThis, {
      AudioContext: TestAudioContext,
      window: {
        setTimeout: (callback: () => void) => {
          const id = nextTimer++;
          timerCalls += 1;
          timers.set(id, callback);
          return id;
        },
        clearTimeout: (id: number) => timers.delete(id),
      },
    });

    try {
      engine = new SynthEngine();
      const voiceEvents: number[][] = [];
      const readyEvents: boolean[] = [];
      engine.onVoices((notes) => voiceEvents.push(notes));
      engine.onReady((ready) => readyEvents.push(ready));
      engine.setWaveform(generatePreset("sine"), true);
      engine.setDriveCurve(generateDrivePreset("identity"));
      engine.noteOn(60);

      const context = TestAudioContext.last;
      assert.ok(context);
      const drive = context.shapers[0];
      const safety = context.shapers[1];
      const lowPass = context.filters[0];
      const dcBlock = context.filters[1];
      assert.ok(drive);
      assert.ok(safety);
      assert.ok(lowPass);
      assert.ok(dcBlock);
      assert.equal(context.shapers.length, 2, "one musical DRIVE plus final safety");
      assert.notEqual(drive, safety);
      assert.equal(lowPass.type, "lowpass");
      assert.equal(lowPass.connections.length, 1);
      const sharedBus = lowPass.connections[0];
      assert.ok(sharedBus instanceof TestGainNode);
      assert.equal(sharedBus.connections.length, 1);

      const driveInputAnalyser = sharedBus.connections[0];
      assert.ok(driveInputAnalyser instanceof TestAnalyserNode);
      assert.equal(driveInputAnalyser.fftSize, 1024);
      assert.equal(driveInputAnalyser.smoothingTimeConstant, 0);
      assert.equal(driveInputAnalyser.connections.length, 1);
      assert.equal(driveInputAnalyser.connections[0], drive);
      assert.equal(drive.oversample, DRIVE_OVERSAMPLE);
      assert.equal(drive.connections.length, 1, "DRIVE must not use a parallel dry path");
      assert.equal(drive.connections[0], dcBlock);
      assert.equal(dcBlock.type, "highpass");
      assert.equal(dcBlock.frequency.value, DRIVE_DC_BLOCK_HZ);
      assert.equal(dcBlock.Q.value, Math.SQRT1_2);
      assert.equal(dcBlock.connections.length, 1);

      const driveGuard = dcBlock.connections[0];
      assert.ok(driveGuard instanceof TestGainNode);
      assert.equal(driveGuard.connections.length, 3);
      assert.equal(driveGuard.gain.value, 1);

      const chorusDry = driveGuard.connections[0];
      const chorusDelayL = driveGuard.connections[1];
      const chorusDelayR = driveGuard.connections[2];
      assert.ok(chorusDry instanceof TestGainNode);
      assert.ok(chorusDelayL instanceof TestDelayNode);
      assert.ok(chorusDelayR instanceof TestDelayNode);
      assert.equal(chorusDelayL.delayTime.value, 0);
      assert.equal(chorusDelayR.delayTime.value, 0);

      const mergerL = chorusDelayL.connections[0];
      const mergerR = chorusDelayR.connections[0];
      assert.ok(mergerL instanceof TestChannelMergerNode);
      assert.equal(mergerR, mergerL);
      assert.equal(chorusDelayL.connectionDetails[0]?.input, 0);
      assert.equal(chorusDelayR.connectionDetails[0]?.input, 1);
      const chorusWet = mergerL.connections[0];
      assert.ok(chorusWet instanceof TestGainNode);
      const chorusSum = chorusDry.connections[0];
      assert.ok(chorusSum instanceof TestGainNode);
      assert.equal(chorusWet.connections[0], chorusSum);
      assert.equal(chorusSum.connections.length, 2);

      const spaceDry = chorusSum.connections[0];
      const spaceWetIn = chorusSum.connections[1];
      assert.ok(spaceDry instanceof TestGainNode);
      assert.ok(spaceWetIn instanceof TestGainNode);
      assert.equal(spaceWetIn.connections[0], context.convolvers[0]);
      assert.equal(spaceWetIn.connections[1], context.convolvers[1]);

      const wetA = context.convolvers[0]?.connections[0];
      const wetB = context.convolvers[1]?.connections[0];
      assert.ok(wetA instanceof TestGainNode);
      assert.ok(wetB instanceof TestGainNode);
      const spaceSum = spaceDry.connections[0];
      assert.ok(spaceSum instanceof TestGainNode);
      assert.equal(wetA.connections[0], spaceSum);
      assert.equal(wetB.connections[0], spaceSum);

      const initialChorusMix = chorusMixGains(0);
      assert.equal(chorusDry.gain.targetCalls[0]?.prior, initialChorusMix.dry);
      assert.equal(chorusWet.gain.targetCalls[0]?.prior, initialChorusMix.wet);
      assert.equal(chorusDry.gain.value, 1, "CHORUS must launch fully dry");
      assert.equal(chorusWet.gain.value, 0, "CHORUS must launch with no wet signal");
      const initialSpaceAngle = 0.38 * (Math.PI / 2);
      assert.equal(spaceDry.gain.targetCalls[0]?.prior, Math.cos(initialSpaceAngle));
      assert.equal(spaceWetIn.gain.targetCalls[0]?.prior, Math.sin(initialSpaceAngle));

      const master = spaceSum.connections[0];
      assert.ok(master instanceof TestGainNode);
      const preSafety = master.connections[0];
      assert.ok(preSafety instanceof TestAnalyserNode);
      assert.equal(preSafety.connections[0], safety);
      const outputAnalyser = safety.connections[0];
      assert.ok(outputAnalyser instanceof TestAnalyserNode);
      assert.equal(outputAnalyser.connections[0], context.destination);
      assert.equal(context.analysers.length, 3);

      driveInputAnalyser.setSamples([-0.42, 0.61, -0.18, 0.2]);
      assert.deepEqual(engine.measureDriveInputRange(), {
        min: -0.41999998688697815,
        max: 0.6100000143051147,
      });

      assert.equal(context.delays.length, 2);
      assert.equal(context.constantSources.length, 2);
      for (let i = 0; i < 2; i++) {
        const lfo: TestOscillatorNode | undefined = context.oscillators[i];
        const lfoGain: TestConnection | undefined = lfo?.connections[0];
        const delay: TestDelayNode | undefined = context.delays[i];
        const bias: TestConstantSourceNode | undefined = context.constantSources[i];
        assert.ok(lfo);
        assert.ok(lfoGain instanceof TestGainNode);
        assert.ok(delay);
        assert.ok(bias);
        assert.equal(lfo.frequency.value, 1 / 1.6);
        assert.equal(lfoGain.gain.value, 0.008);
        assert.equal(lfoGain.connections[0], delay.delayTime);
        assert.equal(bias.offset.value, 0.016);
        assert.equal(bias.connections[0], delay.delayTime);
        assert.equal(bias.offset.value - lfoGain.gain.value, 0.008);
        assert.equal(bias.offset.value + lfoGain.gain.value, 0.024);
      }

      engine.setChorusMix(0);
      assert.equal(chorusDry.gain.value, 1);
      assert.equal(chorusWet.gain.value, 0);
      engine.setChorusMix(1);
      assert.equal(chorusDry.gain.value, 0);
      assert.equal(chorusWet.gain.value, 1);
      engine.setChorusPeriod(0.25);
      assert.equal(context.oscillators[0]?.frequency.value, 4);
      assert.equal(context.oscillators[1]?.frequency.value, 4);

      assert.equal(drive.curve?.length, DRIVE_CURVE_SIZE);
      const safetyCurve = safety.curve;
      assert.equal(safetyCurve?.length, 65537);
      assert.equal(safety.oversample, "none");
      assert.deepEqual(voiceEvents.at(-1), [60]);
      assert.equal(context.oscillators.length, 3);
      assert.deepEqual(readyEvents, [true]);

      const hard = generateDrivePreset("hard");
      engine.setDriveCurve(hard);
      const probeIndex = Math.floor(DRIVE_CURVE_SIZE * 0.75);
      assert.equal(drive.curve?.[probeIndex], 0.625);
      assert.deepEqual(
        drive.curve,
        buildAppliedDriveCurve(hard, DRIVE_DEFAULT_AMOUNT),
      );
      const defaultGuardTarget = driveGuard.gain.targetCalls.at(-1);
      assert.ok(defaultGuardTarget);
      assert.ok(defaultGuardTarget.value < 1);
      assert.ok(defaultGuardTarget.timeConstant > 0);
      assert.equal(context.oscillators.length, 3, "DRIVE must not replace a held oscillator");

      const safeAppliedCurve = drive.curve;
      engine.setDriveState(hard, DRIVE_DEFAULT_AMOUNT, false);
      assert.deepEqual(
        drive.curve,
        safeAppliedCurve,
        "disabling SAFE must leave the settled Amount unchanged",
      );
      assert.equal(driveGuard.gain.targetCalls.at(-1)?.value, 1);

      engine.setDriveState(hard, 1, false);
      assert.deepEqual(drive.curve, buildDriveCurve(hard));
      assert.equal(driveGuard.gain.targetCalls.at(-1)?.value, 1);
      assert.ok((driveGuard.gain.targetCalls.at(-1)?.timeConstant ?? 0) > 0);

      engine.setDriveState(hard, 0, false);
      assert.deepEqual(
        drive.curve,
        buildDriveCurve(generateDrivePreset("identity")),
      );
      engine.setDriveState(generateDrivePreset("identity"), 0.73, false);
      assert.deepEqual(
        drive.curve,
        buildDriveCurve(generateDrivePreset("identity")),
      );

      engine.setDriveState(hard, 1, false);
      const assignmentsBeforeClamp = drive.curveAssignments.length;
      const guardCallsBeforeClamp = driveGuard.gain.targetCalls.length;
      engine.setDriveState(hard, DRIVE_DEFAULT_AMOUNT, true, true);
      const clampTimers = [...timers.entries()];
      assert.ok(clampTimers.length > 1, "SAFE clamp should use intermediate curves");
      let previousProbe = drive.curve?.[probeIndex] ?? 0;
      for (const [id, callback] of clampTimers) {
        timers.delete(id);
        callback();
        const nextProbe = drive.curve?.[probeIndex] ?? 0;
        assert.ok(nextProbe <= previousProbe);
        assert.ok(nextProbe >= 0.625);
        previousProbe = nextProbe;
      }
      assert.ok(drive.curveAssignments.length > assignmentsBeforeClamp + 1);
      assert.deepEqual(
        drive.curve,
        buildAppliedDriveCurve(hard, DRIVE_DEFAULT_AMOUNT),
      );
      const clampGuardCalls = driveGuard.gain.targetCalls.slice(guardCallsBeforeClamp);
      assert.ok(clampGuardCalls.length > 1);
      assert.ok(clampGuardCalls.every((call) => call.value <= 1));
      assert.ok((clampGuardCalls.at(-1)?.value ?? 1) < 1);

      engine.setDriveState(hard, 1, false);
      engine.setDriveState(hard, DRIVE_DEFAULT_AMOUNT, true, true);
      const interruptedTimers = [...timers.entries()];
      for (const [id, callback] of interruptedTimers.slice(0, 4)) {
        timers.delete(id);
        callback();
      }
      const probeBeforeDisable = drive.curve?.[probeIndex];
      engine.setDriveState(hard, DRIVE_DEFAULT_AMOUNT, false);
      assert.equal(
        drive.curve?.[probeIndex],
        probeBeforeDisable,
        "disabling SAFE mid-clamp must continue rather than jump",
      );
      assert.equal(driveGuard.gain.targetCalls.at(-1)?.value, 1);
      for (const [id] of interruptedTimers) assert.equal(timers.has(id), false);
      const continuedTimers = [...timers.entries()];
      assert.ok(continuedTimers.length > 1);
      for (const [id, callback] of continuedTimers) {
        timers.delete(id);
        callback();
      }
      assert.deepEqual(
        drive.curve,
        buildAppliedDriveCurve(hard, DRIVE_DEFAULT_AMOUNT),
      );

      engine.setChorusCurve(generateChorusPreset("wild"));
      assert.equal(context.oscillators.length, 3, "CHORUS must update its LFOs in place");
      assert.ok(context.oscillators[0]?.wave);
      assert.ok(context.oscillators[1]?.wave);

      engine.setChorusCurve(new Array(256).fill(1));
      for (let i = 0; i < 2; i++) {
        const lfo = context.oscillators[i];
        const bias: TestConstantSourceNode | undefined = context.constantSources[i];
        assert.ok(lfo?.wave);
        assert.ok(bias);
        assert.equal(bias.offset.value, 0.024);
        const wave = lfo.wave as unknown as TestPeriodicWave;
        assert.ok(wave.real.every((value) => value === 0));
        assert.ok(wave.imag.every((value) => value === 0));
      }

      engine.setChorusCurve(generateChorusPreset("rise"));
      const leftRise = context.oscillators[0]?.wave as unknown as TestPeriodicWave;
      const rightRise = context.oscillators[1]?.wave as unknown as TestPeriodicWave;
      for (let k = 1; k < leftRise.real.length; k++) {
        const sign = k % 2 === 0 ? 1 : -1;
        assert.equal(rightRise.real[k], sign * (leftRise.real[k] ?? 0));
        assert.equal(rightRise.imag[k], sign * (leftRise.imag[k] ?? 0));
      }
      for (let channel = 0; channel < 2; channel++) {
        const lfo = context.oscillators[channel];
        const bias: TestConstantSourceNode | undefined = context.constantSources[channel];
        assert.ok(lfo?.wave);
        assert.ok(bias);
        const wave = lfo.wave as unknown as TestPeriodicWave;
        assert.equal(wave.disableNormalization, true);
        assert.equal(
          bias.offset.targetCalls.length,
          0,
          "CHORUS curve and DC bias must change together, without a mismatched glide",
        );
        assert.equal(bias.offset.setValueCalls.at(-1), bias.offset.value);
        for (let i = 0; i < 4096; i++) {
          const position =
            (bias.offset.value - 0.016) / 0.008 + periodicValue(wave, i / 4096);
          assert.ok(position >= -1.000001 && position <= 1.000001, `${position}`);
        }
      }

      engine.setSpace(generateSpaceContour("room"), 0xc0ffee, false, 3);
      assert.equal(context.convolvers[0]?.buffer?.length, 48000 * 3);
      engine.setSpace(generateSpaceContour("long"), 0xc0ffef, false, 1);
      assert.equal(context.convolvers[1]?.buffer?.length, 48000);
      assert.equal(wetA.gain.value, 0);
      assert.equal(wetB.gain.value, 1);
      assert.deepEqual(voiceEvents.at(-1), [60]);
      assert.equal(safety.curve, safetyCurve, "musical DRIVE must not replace final safety");

      engine.setDriveState(hard, 1, false);
      engine.setDriveState(hard, DRIVE_DEFAULT_AMOUNT, true, true);
      const pendingDriveTimers = new Set(timers.keys());
      assert.ok(pendingDriveTimers.size > 1);

      engine.noteOff(60);
      assert.deepEqual(voiceEvents.at(-1), []);
      const timerCallsBeforeWave = timerCalls;
      engine.setWaveform(generatePreset("triangle"), false);
      assert.equal(timerCalls, timerCallsBeforeWave + 1);
      engine.dispose();
      for (const id of pendingDriveTimers) assert.equal(timers.has(id), false);
      assert.equal(context.closed, true);
      assert.deepEqual(readyEvents, [true, false]);
      assert.ok(context.oscillators[0]?.stopped);
      assert.ok(context.oscillators[1]?.stopped);
      assert.ok(context.constantSources[0]?.stopped);
      assert.ok(context.constantSources[1]?.stopped);

      engine.noteOn(62);
      const rebuilt = TestAudioContext.last;
      assert.ok(rebuilt);
      assert.notEqual(rebuilt, context);
      const timerCallsBeforeReuse = timerCalls;
      engine.setWaveform(generatePreset("saw"), false);
      assert.equal(
        timerCalls,
        timerCallsBeforeReuse + 1,
        "dispose must not leave waveform throttling locked",
      );
      assert.deepEqual(readyEvents, [true, false, true]);
      engine.dispose();
    } finally {
      engine?.dispose();
      Object.assign(globalThis, {
        AudioContext: originalAudioContext,
        window: originalWindow,
      });
    }
  });
});
