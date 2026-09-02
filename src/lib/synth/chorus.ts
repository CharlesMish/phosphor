import { waveformToCoefficients } from "./waveform";

/** One authored chorus modulation cycle. Values are normalized delay position. */
export const CHORUS_SIZE = 256;
export const CHORUS_MIN_MS = 8;
export const CHORUS_MAX_MS = 24;
export const CHORUS_DEFAULT_PERIOD = 1.6;

export type ChorusPreset = "sine" | "triangle" | "rise" | "wild";

export const CHORUS_PRESET_ORDER: ChorusPreset[] = ["sine", "triangle", "rise", "wild"];
export const CHORUS_PRESET_LABEL: Record<ChorusPreset, string> = {
  sine: "Sine",
  triangle: "Tri",
  rise: "Rise",
  wild: "Wild",
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function chorusDelayMs(position: number): number {
  return CHORUS_MIN_MS + clamp01((position + 1) / 2) * (CHORUS_MAX_MS - CHORUS_MIN_MS);
}

export function chorusPosition(delayMs: number): number {
  return clamp01((delayMs - CHORUS_MIN_MS) / (CHORUS_MAX_MS - CHORUS_MIN_MS)) * 2 - 1;
}

export function chorusMixGains(mix: number): { dry: number; wet: number } {
  const x = clamp01(mix);
  if (x === 0) return { dry: 1, wet: 0 };
  if (x === 1) return { dry: 0, wet: 1 };
  const angle = x * (Math.PI / 2);
  return { dry: Math.cos(angle), wet: Math.sin(angle) };
}

export function phaseShiftCurve(curve: number[], phase = 0.5): number[] {
  const n = curve.length;
  if (n === 0) return [];
  const shift = Math.round((((phase % 1) + 1) % 1) * n);
  return curve.map((_, i) => curve[(i + shift) % n] ?? 0);
}

export function generateChorusPreset(kind: ChorusPreset): number[] {
  const out = new Array<number>(CHORUS_SIZE);
  for (let i = 0; i < CHORUS_SIZE; i++) {
    const t = i / CHORUS_SIZE;
    if (kind === "sine") out[i] = Math.sin(2 * Math.PI * t);
    else if (kind === "triangle") out[i] = 1 - 4 * Math.abs(t - 0.5);
    else if (kind === "rise") out[i] = 2 * t - 1;
    else out[i] = Math.sin(2 * Math.PI * t) * 0.6 + Math.sin(6 * Math.PI * t) * 0.25;
  }
  return out;
}

export function cloneChorusCurve(curve: number[]) {
  return curve.slice();
}

export function chorusCurvesDiffer(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

export function identifyChorusPreset(curve: number[]): ChorusPreset | "custom" {
  for (const preset of CHORUS_PRESET_ORDER) {
    if (!chorusCurvesDiffer(curve, generateChorusPreset(preset))) return preset;
  }
  return "custom";
}

export type ChorusPeriodicWave = {
  /** Mean authored position, supplied separately because PeriodicWave drops DC. */
  bias: number;
  real: Float32Array;
  imag: Float32Array;
};

function clampPosition(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

/**
 * Convert an authored delay curve into a bounded, zero-mean PeriodicWave plus
 * a separate DC bias. Web Audio discards coefficient zero, and truncated
 * Fourier curves can ring beyond their authored range, so both steps are
 * necessary to keep the rendered delay inside the advertised 8–24 ms range.
 */
export function buildChorusPeriodicWave(
  curve: number[],
  harmonicCount = Math.floor(CHORUS_SIZE / 2),
): ChorusPeriodicWave {
  const authored = curve.length > 0 ? curve.map(clampPosition) : [0];
  const bias = clampPosition(
    authored.reduce((sum, value) => sum + value, 0) / authored.length,
  );
  const { real, imag } = waveformToCoefficients(authored, harmonicCount);
  let degree = 0;
  for (let k = 1; k < real.length; k++) {
    if (Math.hypot(real[k] ?? 0, imag[k] ?? 0) <= 1e-7) {
      real[k] = 0;
      imag[k] = 0;
    } else {
      degree = k;
    }
  }

  // Find the extrema of the band-limited reconstruction on a grid much denser
  // than the editor. This catches Gibbs overshoot from sharp drawn corners.
  const steps = Math.max(4096, authored.length * 16);
  let minimum = 0;
  let maximum = 0;
  for (let i = 0; i < steps; i++) {
    const phase = (2 * Math.PI * i) / steps;
    const phaseCos = Math.cos(phase);
    const phaseSin = Math.sin(phase);
    let harmonicCos = 1;
    let harmonicSin = 0;
    let value = 0;
    for (let k = 1; k < real.length; k++) {
      const nextCos = harmonicCos * phaseCos - harmonicSin * phaseSin;
      harmonicSin = harmonicSin * phaseCos + harmonicCos * phaseSin;
      harmonicCos = nextCos;
      value += (real[k] ?? 0) * harmonicCos + (imag[k] ?? 0) * harmonicSin;
    }
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }

  // A sampled grid alone can miss a narrow extremum in a high-harmonic custom
  // curve. Pad both extrema using the trigonometric polynomial's highest
  // significant degree. Numerical crumbs were removed above, so this bound is
  // applied to the exact coefficients handed to Web Audio.
  const phaseRadius = (degree * Math.PI) / steps;
  const curvatureRatio = Math.min(0.25, 0.5 * phaseRadius * phaseRadius);
  const sampledMagnitude = Math.max(maximum, -minimum);
  const gridMargin =
    (sampledMagnitude * curvatureRatio) / (1 - curvatureRatio) +
    1e-7;
  const boundedMinimum = minimum - gridMargin;
  const boundedMaximum = maximum + gridMargin;

  let scale = 1;
  if (boundedMaximum > 0) scale = Math.min(scale, (1 - bias) / boundedMaximum);
  if (boundedMinimum < 0) scale = Math.min(scale, (-1 - bias) / boundedMinimum);
  scale = Math.min(1, Math.max(0, scale));
  if (scale < 1) {
    for (let k = 1; k < real.length; k++) {
      real[k] = (real[k] ?? 0) * scale;
      imag[k] = (imag[k] ?? 0) * scale;
    }
  }

  return { bias, real, imag };
}
