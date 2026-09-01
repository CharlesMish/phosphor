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
  DRIVE_DC_BLOCK_HZ,
  DRIVE_OVERSAMPLE,
  SynthEngine,
} from "./engine.ts";
import { useSynthStore } from "./store.ts";
import { generatePreset } from "./waveform.ts";
import { chorusMixGains, generateChorusPreset } from "./chorus.ts";
import { generateSpaceContour } from "./space.ts";

class TestAudioParam {
  value = 0;
  readonly setValueCalls: number[] = [];
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

  linearRampToValueAtTime(value: number) {
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

  getFloatTimeDomainData(data: Float32Array) {
    data.fill(0);
  }
}

class TestOscillatorNode extends TestAudioNode {
  readonly frequency = new TestAudioParam();
  type: OscillatorType = "sine";
  onended: (() => void) | null = null;
  wave: PeriodicWave | null = null;
  started = false;
  stopped = false;

  setPeriodicWave(wave: PeriodicWave) {
    this.wave = wave;
  }

  start() {
    this.started = true;
  }

  stop() {
    this.stopped = true;
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
  readonly oscillators: TestOscillatorNode[] = [];
  readonly periodicWaves: TestPeriodicWave[] = [];
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
    return new TestGainNode();
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
    return new TestAnalyserNode();
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
  it("orders DRIVE, CHORUS, SPACE, and final safety without replacing a held note", () => {
    const originalAudioContext = globalThis.AudioContext;
    const originalWindow = globalThis.window;
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
      const engine = new SynthEngine();
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
      assert.equal(lowPass.connections[0], drive);
      assert.equal(drive.oversample, DRIVE_OVERSAMPLE);
      assert.equal(drive.connections.length, 1, "DRIVE must not use a parallel dry path");
      assert.equal(drive.connections[0], dcBlock);
      assert.equal(dcBlock.type, "highpass");
      assert.equal(dcBlock.frequency.value, DRIVE_DC_BLOCK_HZ);
      assert.equal(dcBlock.Q.value, Math.SQRT1_2);
      assert.equal(dcBlock.connections.length, 1);

      const driveGuard = dcBlock.connections[0];
      assert.ok(driveGuard instanceof TestGainNode);
      assert.equal(driveGuard.connections.length, 1);
      assert.equal(driveGuard.gain.value, 1);
      const sharedBus = driveGuard.connections[0];
      assert.ok(sharedBus instanceof TestGainNode);
      assert.equal(sharedBus.connections.length, 3);

      const chorusDry = sharedBus.connections[0];
      const chorusDelayL = sharedBus.connections[1];
      const chorusDelayR = sharedBus.connections[2];
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
      Object.assign(globalThis, {
        AudioContext: originalAudioContext,
        window: originalWindow,
      });
    }
  });
});
