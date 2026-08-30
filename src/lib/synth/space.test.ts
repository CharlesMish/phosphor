import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SPACE_IR_PEAK_LIMIT,
  SPACE_IR_TARGET_L2,
  SPACE_SIZE,
  buildSpaceBuffer,
  generateSpaceContour,
  metalModeFrequencies,
  normalizeIrPair,
  type SpacePreset,
} from "./space.ts";
import {
  OUTPUT_SAFETY_CEILING,
  OUTPUT_SAFETY_THRESHOLD,
  buildOutputSafetyCurve,
} from "./safety.ts";

class TestAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (!data) throw new RangeError(`missing channel ${channel}`);
    return data;
  }
}

function testContext(sampleRate: number): AudioContext {
  return {
    sampleRate,
    createBuffer: (channels: number, length: number, sr: number) =>
      new TestAudioBuffer(channels, length, sr),
  } as unknown as AudioContext;
}

function pairMetrics(buffer: AudioBuffer) {
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  let energy = 0;
  let peak = 0;
  let weightedTime = 0;
  for (let i = 0; i < left.length; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    const e = l * l + r * r;
    energy += e;
    weightedTime += (i / buffer.sampleRate) * e;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  return {
    l2: Math.sqrt(energy),
    peak,
    centroid: energy > 0 ? weightedTime / energy : 0,
  };
}

function pairCosine(a: AudioBuffer, b: AudioBuffer): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let channel = 0; channel < 2; channel++) {
    const x = a.getChannelData(channel);
    const y = b.getChannelData(channel);
    for (let i = 0; i < x.length; i++) {
      const xv = x[i] ?? 0;
      const yv = y[i] ?? 0;
      dot += xv * yv;
      aa += xv * xv;
      bb += yv * yv;
    }
  }
  return dot / Math.sqrt(aa * bb);
}

function stereoSineGain(buffer: AudioBuffer, frequency: number): number {
  const omega = (2 * Math.PI * frequency) / buffer.sampleRate;
  let stereoMagnitudeSquared = 0;
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let re = 0;
    let im = 0;
    for (let i = 0; i < data.length; i++) {
      const phase = omega * i;
      re += (data[i] ?? 0) * Math.cos(phase);
      im -= (data[i] ?? 0) * Math.sin(phase);
    }
    stereoMagnitudeSquared += re * re + im * im;
  }
  return Math.sqrt(stereoMagnitudeSquared / 2);
}

describe("SPACE impulse-response gain", () => {
  it("uses one shared stereo L2 factor", () => {
    const left = new Float32Array([3, 0]);
    const right = new Float32Array([0, 4]);
    const gain = normalizeIrPair(left, right, 1.2, 10);

    assert.ok(Math.abs(gain - 0.24) < 1e-7);
    assert.ok(Math.abs((left[0] ?? 0) - 0.72) < 1e-6);
    assert.ok(Math.abs((right[1] ?? 0) - 0.96) < 1e-6);
    assert.equal(left[1], 0);
    assert.equal(right[0], 0);
  });

  it("is sample-rate independent for every preset and a flat custom contour", () => {
    const presets: SpacePreset[] = ["room", "long", "echo", "reverse", "metal"];
    const contours: Array<[string, number[], boolean]> = [
      ...presets.map(
        (preset): [string, number[], boolean] => [
          preset,
          generateSpaceContour(preset),
          preset === "metal",
        ],
      ),
      ["flat", new Array<number>(SPACE_SIZE).fill(1), false],
    ];

    for (const sampleRate of [44100, 48000, 96000]) {
      for (const [name, contour, metal] of contours) {
        const buffer = buildSpaceBuffer(contour, 0xc0ffee, testContext(sampleRate), metal);
        const metrics = pairMetrics(buffer);
        assert.ok(
          Math.abs(metrics.l2 - SPACE_IR_TARGET_L2) < 5e-5,
          `${name} @ ${sampleRate} Hz L2=${metrics.l2}`,
        );
        assert.ok(
          metrics.peak <= SPACE_IR_PEAK_LIMIT + 1e-6,
          `${name} @ ${sampleRate} Hz peak=${metrics.peak}`,
        );
      }
    }
  });

  it("leaves a zero contour silent and finite", () => {
    const buffer = buildSpaceBuffer(
      new Array<number>(SPACE_SIZE).fill(0),
      123,
      testContext(48000),
    );
    assert.deepEqual(pairMetrics(buffer), { l2: 0, peak: 0, centroid: 0 });
  });
});

describe("SPACE response identity", () => {
  it("retains distinct temporal energy shapes", () => {
    const ctx = testContext(48000);
    const centroid = (preset: SpacePreset) =>
      pairMetrics(
        buildSpaceBuffer(
          generateSpaceContour(preset),
          0xc0ffee,
          ctx,
          preset === "metal",
        ),
      ).centroid;
    const room = centroid("room");
    const echo = centroid("echo");
    const metal = centroid("metal");
    const long = centroid("long");
    const flat = pairMetrics(
      buildSpaceBuffer(new Array<number>(SPACE_SIZE).fill(1), 0xc0ffee, ctx),
    ).centroid;
    const reverse = centroid("reverse");

    assert.ok(
      room < echo && echo < metal && metal < long && long < flat && flat < reverse,
      JSON.stringify({ room, echo, metal, long, flat, reverse }),
    );
  });

  it("is deterministic while Scatter changes the microstructure", () => {
    const ctx = testContext(48000);
    const contour = generateSpaceContour("long");
    const first = buildSpaceBuffer(contour, 0xc0ffee, ctx);
    const repeat = buildSpaceBuffer(contour, 0xc0ffee, ctx);
    const scattered = buildSpaceBuffer(contour, 0x9f3879a7, ctx);

    assert.deepEqual(first.getChannelData(0), repeat.getChannelData(0));
    assert.deepEqual(first.getChannelData(1), repeat.getChannelData(1));
    assert.ok(Math.abs(pairCosine(first, scattered)) < 0.03);
    assert.ok(Math.abs(pairMetrics(scattered).l2 - SPACE_IR_TARGET_L2) < 5e-5);
  });

  it("keeps Metal resonant without exceptional narrowband gain", () => {
    const ctx = testContext(48000);
    const contour = generateSpaceContour("metal");
    const seeds = [0xc0ffee, 0x9f3879a7, 0x3d6ff360];
    const maxima = seeds.map((seed) => {
      const buffer = buildSpaceBuffer(contour, seed, ctx, true);
      return Math.max(
        ...metalModeFrequencies(seed).map((frequency) =>
          stereoSineGain(buffer, frequency),
        ),
      );
    });

    assert.ok(maxima[0]! > 1.1, `initial Metal resonance=${maxima[0]}`);
    assert.ok(Math.max(...maxima) < 3.2, `Metal resonance maxima=${maxima.join(", ")}`);
  });
});

describe("output safety curve", () => {
  it("is identity in the normal range and bounded without time-domain pumping", () => {
    const curve = buildOutputSafetyCurve();
    let previous = -Infinity;
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      const y = curve[i] ?? 0;
      assert.ok(y >= previous, `curve is not monotonic at ${i}`);
      previous = y;
      assert.ok(Math.abs(y) <= OUTPUT_SAFETY_CEILING + 1e-6);
      if (Math.abs(x) <= OUTPUT_SAFETY_THRESHOLD) {
        assert.ok(Math.abs(y - x) < 1e-6, `non-identity sample at ${x}: ${y}`);
      }
      const mirror = curve[curve.length - 1 - i] ?? 0;
      assert.ok(Math.abs(y + mirror) < 1e-6, `curve is not odd at ${i}`);
    }
  });
});
