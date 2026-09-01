import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRIVE_CURVE_SIZE,
  buildDriveCurve,
  generateDrivePreset,
  sampleTransfer,
} from "./drive.ts";
import { SynthEngine } from "./engine.ts";
import { useSynthStore } from "./store.ts";
import { generatePreset } from "./waveform.ts";

class TestAudioParam {
  value = 0;

  setValueAtTime(value: number) {
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

  setTargetAtTime(value: number) {
    this.value = value;
    return this;
  }

  cancelScheduledValues() {
    return this;
  }
}

class TestAudioNode {
  readonly connections: TestAudioNode[] = [];

  connect(target: TestAudioNode) {
    this.connections.push(target);
    return target;
  }

  disconnect() {
    this.connections.length = 0;
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
  curve: Float32Array<ArrayBuffer> | null = null;
  oversample: OverSampleType = "none";
}

class TestConvolverNode extends TestAudioNode {
  normalize = true;
  buffer: AudioBuffer | null = null;
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
  onended: (() => void) | null = null;
  wave: PeriodicWave | null = null;

  setPeriodicWave(wave: PeriodicWave) {
    this.wave = wave;
  }

  start() {}

  stop() {}
}

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
  readonly oscillators: TestOscillatorNode[] = [];

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
    return new TestConvolverNode();
  }

  createAnalyser() {
    return new TestAnalyserNode();
  }

  createOscillator() {
    const node = new TestOscillatorNode();
    this.oscillators.push(node);
    return node;
  }

  createPeriodicWave() {
    return {} as PeriodicWave;
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    return new TestAudioBuffer(channels, length, sampleRate);
  }

  resume() {
    return Promise.resolve();
  }

  close() {
    return Promise.resolve();
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
    assert.ok(Math.abs(positive + negative) > 0.08, `${negative}, ${positive}`);
    assert.ok(sampleTransfer(curve, 0) > 0.05);
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

describe("DRIVE live audio graph", () => {
  it("updates a held note in place and still releases it", () => {
    const originalAudioContext = globalThis.AudioContext;
    const originalWindow = globalThis.window;
    Object.assign(globalThis, {
      AudioContext: TestAudioContext,
      window: {
        setTimeout: () => 1,
        clearTimeout: () => undefined,
      },
    });

    try {
      const engine = new SynthEngine();
      const voiceEvents: number[][] = [];
      engine.onVoices((notes) => voiceEvents.push(notes));
      engine.setWaveform(generatePreset("sine"), true);
      engine.setDriveCurve(generateDrivePreset("identity"));
      engine.noteOn(60);

      const context = TestAudioContext.last;
      assert.ok(context);
      const drive = context.shapers[0];
      const safety = context.shapers[1];
      assert.ok(drive);
      assert.ok(safety);
      assert.equal(context.filters[0]?.connections[0], drive);
      assert.equal(drive.connections[0]?.connections.length, 2);
      assert.equal(drive.curve?.length, DRIVE_CURVE_SIZE);
      const safetyCurve = safety.curve;
      assert.equal(safetyCurve?.length, 65537);
      assert.deepEqual(voiceEvents.at(-1), [60]);
      assert.equal(context.oscillators.length, 1);

      const hard = generateDrivePreset("hard");
      engine.setDriveCurve(hard);
      assert.equal(drive.curve?.[Math.floor(DRIVE_CURVE_SIZE * 0.75)], 1);
      assert.equal(context.oscillators.length, 1, "DRIVE must not replace a held oscillator");
      assert.deepEqual(voiceEvents.at(-1), [60]);
      assert.equal(safety.curve, safetyCurve, "musical DRIVE must not replace final safety");

      engine.noteOff(60);
      assert.deepEqual(voiceEvents.at(-1), []);
      engine.dispose();
    } finally {
      Object.assign(globalThis, {
        AudioContext: originalAudioContext,
        window: originalWindow,
      });
    }
  });
});
