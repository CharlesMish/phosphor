/** Samples in one oscillator cycle. Enough for drawing, cheap to DFT. */
export const WAVE_SIZE = 512;

/** Harmonic bins passed to PeriodicWave (DC + harmonics). */
export const HARMONIC_COUNT = 256;

export type WavePreset = "sine" | "triangle" | "saw" | "square" | "wild";

export const PRESET_ORDER: WavePreset[] = [
  "sine",
  "triangle",
  "saw",
  "square",
  "wild",
];

export const PRESET_LABEL: Record<WavePreset, string> = {
  sine: "Sine",
  triangle: "Tri",
  saw: "Saw",
  square: "Sqr",
  wild: "Wild",
};

export function makeEmptyWave(fill = 0): number[] {
  return Array.from({ length: WAVE_SIZE }, () => fill);
}

export function generatePreset(kind: WavePreset): number[] {
  const n = WAVE_SIZE;
  const out = new Array<number>(n);

  if (kind === "wild") {
    return generateWild();
  }

  for (let i = 0; i < n; i++) {
    const t = i / n;
    switch (kind) {
      case "sine":
        out[i] = Math.sin(2 * Math.PI * t);
        break;
      case "triangle": {
        const p = (t + 0.25) % 1;
        out[i] = p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
        break;
      }
      case "saw":
        out[i] = 2 * t - 1;
        break;
      case "square":
        out[i] = t < 0.5 ? 1 : -1;
        break;
    }
  }
  return out;
}

/** Random piecewise-linear cycle — pitched and weird, not white noise. */
function generateWild(): number[] {
  const n = WAVE_SIZE;
  const vertices = 7 + Math.floor(Math.random() * 9);
  const xs: number[] = [0];
  const ys: number[] = [Math.random() * 1.8 - 0.9];
  for (let v = 1; v < vertices; v++) {
    xs.push(Math.floor((v / vertices) * n));
    ys.push(Math.random() * 1.8 - 0.9);
  }
  xs.push(n);
  ys.push(ys[0] ?? 0);

  const out = new Array<number>(n);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    while (seg < xs.length - 2 && i >= (xs[seg + 1] ?? n)) seg += 1;
    const x0 = xs[seg] ?? 0;
    const x1 = xs[seg + 1] ?? n;
    const y0 = ys[seg] ?? 0;
    const y1 = ys[seg + 1] ?? 0;
    const span = Math.max(1, x1 - x0);
    const u = (i - x0) / span;
    out[i] = y0 + (y1 - y0) * u;
  }
  return normalizeWave(out, 0.92);
}

export function peakOf(samples: number[]): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i] ?? 0);
    if (a > peak) peak = a;
  }
  return peak;
}

export function meanOf(samples: number[]): number {
  if (samples.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i] ?? 0;
  return s / samples.length;
}

/** Remove DC and scale peak to `target`. Silent input stays silent. */
export function normalizeWave(samples: number[], target = 0.92): number[] {
  const n = samples.length;
  const dc = meanOf(samples);
  const shifted = new Array<number>(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = (samples[i] ?? 0) - dc;
    shifted[i] = v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  if (peak < 1e-6) return makeEmptyWave(0);
  const g = target / peak;
  for (let i = 0; i < n; i++) shifted[i] = (shifted[i] ?? 0) * g;
  return shifted;
}

/** Circular 3-tap. One pass rounds jitters without melting corners into a sine. */
export function smoothWave(samples: number[], passes = 1): number[] {
  const n = samples.length;
  let cur = samples.slice();
  for (let p = 0; p < passes; p++) {
    const next = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const a = cur[(i - 1 + n) % n] ?? 0;
      const b = cur[i] ?? 0;
      const c = cur[(i + 1) % n] ?? 0;
      next[i] = 0.25 * a + 0.5 * b + 0.25 * c;
    }
    cur = next;
  }
  return cur;
}

export function invertWave(samples: number[]): number[] {
  return samples.map((v) => -v);
}

/** Copy the first half into the second half, mirrored. */
export function mirrorWave(samples: number[]): number[] {
  const n = samples.length;
  const out = samples.slice();
  const half = Math.floor(n / 2);
  for (let i = 0; i < half; i++) {
    out[n - 1 - i] = out[i] ?? 0;
  }
  return out;
}

export function cloneWave(samples: number[]): number[] {
  return samples.slice();
}

export function lerpWaves(a: number[], b: number[], t: number): number[] {
  const n = Math.min(a.length, b.length);
  const u = Math.min(1, Math.max(0, t));
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = (a[i] ?? 0) * (1 - u) + (b[i] ?? 0) * u;
  }
  return out;
}

/**
 * Condition the two authored endpoints independently, then preserve their
 * honest linear relationship at every intermediate position. In particular,
 * identical endpoints remain identical and opposite endpoints cancel at 0.5.
 */
export function lerpConditionedWaves(
  a: number[],
  b: number[],
  t: number,
  target = 0.92,
): number[] {
  const u = Math.min(1, Math.max(0, t));
  const conditionedA = normalizeWave(a, target);
  if (!wavesDiffer(a, b)) return conditionedA;
  const conditionedB = normalizeWave(b, target);
  if (u <= 0) return conditionedA;
  if (u >= 1) return conditionedB;
  return lerpWaves(conditionedA, conditionedB, u);
}

export function wavesDiffer(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

export function samplesToPath(samples: number[], w: number, h: number, stride = 8): string {
  const n = samples.length;
  if (n === 0) return "";
  const pts: string[] = [];
  for (let i = 0; i < n; i += stride) {
    const x = (i / Math.max(1, n - 1)) * w;
    const y = (0.5 - (samples[i] ?? 0) * 0.42) * h;
    pts.push(`${pts.length === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  const last = samples[n - 1] ?? 0;
  pts.push(`L${w.toFixed(1)} ${(0.5 - last * 0.42) * h}`);
  return pts.join(" ");
}

/**
 * Real DFT → cosine/sine coefficients for OscillatorNode.createPeriodicWave.
 *
 * Output convention (Web Audio):
 *   x(t) = Σ (real[k] cos(kωt) − imag[k] sin(kωt))
 */
export function waveformToCoefficients(
  samples: number[],
  harmonicCount = HARMONIC_COUNT,
): { real: Float32Array; imag: Float32Array } {
  const n = samples.length;
  const bins = Math.max(2, Math.min(harmonicCount, Math.floor(n / 2)));
  const real = new Float32Array(bins);
  const imag = new Float32Array(bins);

  const dc = meanOf(samples);
  real[0] = 0;
  imag[0] = 0;

  const twoOverN = 2 / n;
  for (let k = 1; k < bins; k++) {
    let re = 0;
    let im = 0;
    const step = (2 * Math.PI * k) / n;
    for (let i = 0; i < n; i++) {
      const x = (samples[i] ?? 0) - dc;
      const a = step * i;
      re += x * Math.cos(a);
      im += x * Math.sin(a);
    }
    real[k] = re * twoOverN;
    imag[k] = -im * twoOverN;
  }
  return { real, imag };
}

/** Linear-interpolate a sample at a fractional index (used by the editor). */
export function sampleAt(samples: number[], t01: number): number {
  const n = samples.length;
  if (n === 0) return 0;
  const x = ((t01 % 1) + 1) % 1;
  const f = x * n;
  const i0 = Math.floor(f) % n;
  const i1 = (i0 + 1) % n;
  const u = f - Math.floor(f);
  return (samples[i0] ?? 0) * (1 - u) + (samples[i1] ?? 0) * u;
}
