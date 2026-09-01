/** Drawing points for the SPACE energy contour. */
export const SPACE_SIZE = 512;

/** Display samples of the actual bipolar IR (dense but canvas-cheap). */
export const SPACE_VIEW = 1536;

/** Selectable physical duration of the complete normalized drawing domain. */
export const SPACE_MIN_SECONDS = 1.0;
export const SPACE_MAX_SECONDS = 3.0;
export const SPACE_DEFAULT_SECONDS = 1.6;
export const SPACE_SECONDS_STEP = 0.1;
/** Original calibration/default, retained for callers that only need the default. */
export const SPACE_SECONDS = SPACE_DEFAULT_SECONDS;

export function clampSpaceSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return SPACE_DEFAULT_SECONDS;
  return Math.min(SPACE_MAX_SECONDS, Math.max(SPACE_MIN_SECONDS, seconds));
}

/**
 * Shared L2 energy for the complete stereo IR.
 *
 * A balanced pair at sqrt(2) gives each channel approximately unit energy.
 * The small empirical trim to 1.5 kept the shipped preset/sine sweep close to
 * the dry path without erasing the useful loudness differences between IRs.
 */
export const SPACE_IR_TARGET_L2 = 1.5;

/** Last-resort guard for extremely sparse custom contours. */
export const SPACE_IR_PEAK_LIMIT = 0.9;

export type SpacePreset = "room" | "long" | "echo" | "reverse" | "metal";

export const SPACE_PRESET_ORDER: SpacePreset[] = [
  "room",
  "long",
  "echo",
  "reverse",
  "metal",
];

export const SPACE_PRESET_LABEL: Record<SpacePreset, string> = {
  room: "Room",
  long: "Long",
  echo: "Echo",
  reverse: "Rev",
  metal: "Metal",
};

export const INITIAL_SPACE_SEED = 0xC0FFEE;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cloneContour(samples: number[]): number[] {
  return samples.slice();
}

export function contoursDiffer(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

export function sampleContour(contour: number[], t01: number): number {
  const n = contour.length;
  if (n === 0) return 0;
  const x = Math.min(1, Math.max(0, t01)) * (n - 1);
  const i = Math.floor(x);
  const j = Math.min(n - 1, i + 1);
  const u = x - i;
  return (contour[i] ?? 0) * (1 - u) + (contour[j] ?? 0) * u;
}

export function normalizeContour(contour: number[], target = 1): number[] {
  let peak = 0;
  for (let i = 0; i < contour.length; i++) {
    const v = contour[i] ?? 0;
    if (v > peak) peak = v;
  }
  if (peak < 1e-6) return contour.map(() => 0);
  const g = target / peak;
  return contour.map((v) => Math.max(0, Math.min(1, v * g)));
}

function peakOf(contour: number[]): number {
  let peak = 0;
  for (let i = 0; i < contour.length; i++) {
    const v = contour[i] ?? 0;
    if (v > peak) peak = v;
  }
  return peak;
}

export function generateSpaceContour(kind: SpacePreset): number[] {
  const n = SPACE_SIZE;
  // Presets are authored once in the normalized drawing domain. Their original
  // 1.6 s calibration defines the shape, but playback stretches/compresses all
  // contour features (including Echo reflections) over the selected duration.
  const T = SPACE_DEFAULT_SECONDS;
  const out = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const u = i / Math.max(1, n - 1);
    const t = u * T;
    switch (kind) {
      case "room": {
        const attack = Math.min(1, t / 0.014);
        out[i] = attack * Math.exp(-t / 0.26);
        break;
      }
      case "long": {
        const attack = Math.min(1, t / 0.02);
        out[i] = attack * Math.exp(-t / 0.92);
        break;
      }
      case "echo": {
        const centers = [0.018, 0.2, 0.42, 0.68, 0.98, 1.28];
        const amps = [1, 0.72, 0.5, 0.36, 0.24, 0.15];
        const width = 0.03;
        let v = 0;
        for (let k = 0; k < centers.length; k++) {
          const d = (t - (centers[k] ?? 0)) / width;
          v += (amps[k] ?? 0) * Math.exp(-d * d);
        }
        out[i] = v;
        break;
      }
      case "reverse": {
        const grow = Math.pow(u, 1.55);
        const cap = u > 0.9 ? Math.max(0, (1 - u) / 0.1) : 1;
        out[i] = grow * cap;
        break;
      }
      case "metal": {
        const env = Math.min(1, t / 0.01) * Math.exp(-t / 0.5);
        const rip = 0.62 + 0.38 * Math.abs(Math.sin(2 * Math.PI * u * 8.25));
        out[i] = env * rip;
        break;
      }
    }
  }
  return normalizeContour(out);
}

/** Dense bipolar grain in −1..+1. Same seed always yields the same sequence. */
export function makeGrain(seed: number, n: number): Float32Array {
  const rand = mulberry32(seed || 1);
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    const hp = w - prev * 0.35;
    prev = w;
    out[i] = w * 0.7 + hp * 0.3;
  }
  return out;
}

let grainCache: { seed: number; n: number; data: Float32Array } | null = null;

function cachedGrain(seed: number, n: number): Float32Array {
  if (grainCache && grainCache.seed === seed && grainCache.n === n) return grainCache.data;
  const data = makeGrain(seed, n);
  grainCache = { seed, n, data };
  return data;
}

export function buildSpaceView(contour: number[], seed: number, n = SPACE_VIEW): number[] {
  const grain = cachedGrain(seed, n);
  const out = new Array<number>(n);
  const den = Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    out[i] = (grain[i] ?? 0) * sampleContour(contour, i / den);
  }
  return out;
}

export function normalizeIrPair(
  left: Float32Array,
  right: Float32Array,
  targetL2 = SPACE_IR_TARGET_L2,
  peakLimit = SPACE_IR_PEAK_LIMIT,
) {
  let energy = 0;
  let peak = 0;
  const n = left.length;
  for (let i = 0; i < n; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    energy += l * l + r * r;
    const a = Math.abs(l) > Math.abs(r) ? Math.abs(l) : Math.abs(r);
    if (a > peak) peak = a;
  }
  const l2 = Math.sqrt(energy);
  if (l2 < 1e-8) return 0;

  // One factor for both channels preserves the generated stereo relationship.
  let g = targetL2 / l2;
  if (peak * g > peakLimit) g = peakLimit / Math.max(peak, 1e-8);
  for (let i = 0; i < n; i++) {
    left[i] = (left[i] ?? 0) * g;
    right[i] = (right[i] ?? 0) * g;
  }
  return g;
}

type MetalMode = {
  frequency: number;
  decay: number;
  phase: number;
  amplitude: number;
  pan: number;
};

function makeMetalModes(seed: number): MetalMode[] {
  const rand = mulberry32(seed ^ 0x51f15e);
  const out: MetalMode[] = [];
  for (let m = 0; m < 7; m++) {
    // The original modal level contributed little L2 energy but produced
    // 20 dB+ narrowband transfer peaks. Keep the long metallic ringing while
    // bringing its resonances into the same range as the stochastic kernels.
    out.push({
      frequency: 180 * Math.pow(1.72, rand() * 5.2),
      decay: 0.1 + rand() * 0.45,
      phase: rand() * Math.PI * 2,
      amplitude: (0.07 + rand() * 0.09) * 0.1,
      pan: 0.2 + rand() * 0.6,
    });
  }
  return out;
}

/** Exact modal centers, exposed for deterministic DSP regression checks. */
export function metalModeFrequencies(seed: number): number[] {
  return makeMetalModes(seed).map((mode) => mode.frequency);
}

function addMetalModes(left: Float32Array, right: Float32Array, sr: number, seed: number) {
  const n = left.length;
  // Modal frequency and decay stay in physical units: they describe the metal
  // itself, while the authored Metal contour is time-scaled with every other
  // drawing. Scaling oscillator frequency would change the preset's identity.
  for (const mode of makeMetalModes(seed)) {
    const twoPiF = 2 * Math.PI * mode.frequency;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const s =
        Math.sin(twoPiF * t + mode.phase) *
        Math.exp(-t / mode.decay) *
        mode.amplitude;
      left[i] = (left[i] ?? 0) + s * (1 - mode.pan);
      right[i] = (right[i] ?? 0) + s * mode.pan;
    }
  }
}

export function buildSpaceBuffer(
  contour: number[],
  seed: number,
  ctx: AudioContext,
  metal = false,
  seconds = SPACE_DEFAULT_SECONDS,
): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.max(256, Math.round(sr * clampSpaceSeconds(seconds)));
  const left = makeGrain(seed, n);
  const right = makeGrain(seed ^ 0xa53c9e37, n);
  const den = Math.max(1, n - 1);
  if (peakOf(contour) < 1e-6) {
    left.fill(0);
    right.fill(0);
  } else {
    for (let i = 0; i < n; i++) {
      const c = sampleContour(contour, i / den);
      left[i] = (left[i] ?? 0) * c;
      right[i] = (right[i] ?? 0) * c;
    }
    if (metal) addMetalModes(left, right, sr, seed);
    normalizeIrPair(left, right);
  }
  const buf = ctx.createBuffer(2, n, sr);
  buf.getChannelData(0).set(left);
  buf.getChannelData(1).set(right);
  return buf;
}

export function contourToPath(contour: number[], w: number, h: number, stride = 8): string {
  const n = contour.length;
  if (n === 0) return "";
  const pts: string[] = [];
  for (let i = 0; i < n; i += stride) {
    const x = (i / Math.max(1, n - 1)) * w;
    const y = (1 - (contour[i] ?? 0) * 0.86) * h;
    pts.push(`${pts.length === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  const last = contour[n - 1] ?? 0;
  pts.push(`L${w.toFixed(1)} ${(1 - last * 0.86) * h}`);
  return pts.join(" ");
}
