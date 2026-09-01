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
