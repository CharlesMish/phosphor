import assert from "node:assert/strict";
import test from "node:test";
import {
  CHORUS_MAX_MS,
  CHORUS_MIN_MS,
  buildChorusPeriodicWave,
  chorusCurvesDiffer,
  chorusDelayMs,
  chorusMixGains,
  chorusPosition,
  generateChorusPreset,
  identifyChorusPreset,
  phaseShiftCurve,
} from "./chorus.ts";

function reconstruct(
  real: Float32Array,
  imag: Float32Array,
  phase: number,
): number {
  let value = 0;
  for (let k = 1; k < real.length; k++) {
    const angle = 2 * Math.PI * k * phase;
    value += (real[k] ?? 0) * Math.cos(angle) + (imag[k] ?? 0) * Math.sin(angle);
  }
  return value;
}

function periodicBounds(
  spec: { bias: number; real: Float32Array; imag: Float32Array },
  steps: number,
) {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < steps; i++) {
    const phase = (2 * Math.PI * i) / steps;
    const phaseCos = Math.cos(phase);
    const phaseSin = Math.sin(phase);
    let harmonicCos = 1;
    let harmonicSin = 0;
    let value = spec.bias;
    for (let k = 1; k < spec.real.length; k++) {
      const nextCos = harmonicCos * phaseCos - harmonicSin * phaseSin;
      harmonicSin = harmonicSin * phaseCos + harmonicCos * phaseSin;
      harmonicCos = nextCos;
      value +=
        (spec.real[k] ?? 0) * harmonicCos +
        (spec.imag[k] ?? 0) * harmonicSin;
    }
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return { minimum, maximum };
}

test("chorus maps the authored position to the honest delay range", () => {
  assert.equal(chorusDelayMs(-1), CHORUS_MIN_MS);
  assert.equal(chorusDelayMs(1), CHORUS_MAX_MS);
  assert.equal(chorusDelayMs(0), (CHORUS_MIN_MS + CHORUS_MAX_MS) / 2);
  assert.equal(chorusPosition(CHORUS_MIN_MS), -1);
  assert.equal(chorusPosition(CHORUS_MAX_MS), 1);
});

test("stereo derivation is deterministic and half a cycle", () => {
  assert.deepEqual(phaseShiftCurve([0, 1, 2, 3]), [2, 3, 0, 1]);
  assert.deepEqual(phaseShiftCurve([0, 1, 2, 3], -0.5), [2, 3, 0, 1]);
});

test("chorus mix keeps dry bypass and wet-only endpoints", () => {
  assert.deepEqual(chorusMixGains(0), { dry: 1, wet: 0 });
  assert.deepEqual(chorusMixGains(1), { dry: 0, wet: 1 });
});

test("chorus preset identity is recovered only for an exact preset curve", () => {
  const triangle = generateChorusPreset("triangle");
  assert.equal(identifyChorusPreset(triangle), "triangle");
  assert.equal(chorusCurvesDiffer(triangle, triangle.slice()), false);

  const custom = triangle.slice();
  custom[42] = (custom[42] ?? 0) + 0.001;
  assert.equal(identifyChorusPreset(custom), "custom");
  assert.equal(chorusCurvesDiffer(triangle, custom), true);
  assert.equal(chorusCurvesDiffer(triangle, triangle.slice(1)), true);
});

test("periodic rendering preserves DC positions and bounds Fourier ringing", () => {
  for (const position of [-1, 0.4, 1]) {
    const spec = buildChorusPeriodicWave(new Array(256).fill(position));
    assert.ok(Math.abs(spec.bias - position) < 1e-12);
    assert.ok(spec.real.every((value) => Math.abs(value) < 1e-12));
    assert.ok(spec.imag.every((value) => Math.abs(value) < 1e-12));
  }

  for (const preset of ["sine", "triangle", "rise", "wild"] as const) {
    const spec = buildChorusPeriodicWave(generateChorusPreset(preset));
    for (let i = 0; i < 16384; i++) {
      const rendered = spec.bias + reconstruct(spec.real, spec.imag, i / 16384);
      assert.ok(rendered >= -1.000001, `${preset} underflowed at ${rendered}`);
      assert.ok(rendered <= 1.000001, `${preset} overflowed at ${rendered}`);
      const delay = chorusDelayMs(rendered);
      assert.ok(delay >= CHORUS_MIN_MS && delay <= CHORUS_MAX_MS);
    }
  }
});

test("custom high-harmonic drawings stay inside the delay domain between grid points", () => {
  const raw = Array.from({ length: 256 }, (_, i) => {
    let value = 0;
    for (let k = 117; k <= 127; k++) {
      value += Math.cos(2 * Math.PI * k * (i / 256 + 1 / 8192));
    }
    return value;
  });
  const peak = Math.max(...raw.map(Math.abs));
  const spec = buildChorusPeriodicWave(raw.map((value) => value / peak));
  const { minimum, maximum } = periodicBounds(spec, 262144);
  assert.ok(minimum >= -1.000001, `custom underflowed at ${minimum}`);
  assert.ok(maximum <= 1.000001, `custom overflowed at ${maximum}`);
});
