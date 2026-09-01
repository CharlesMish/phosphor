/** Editable samples spanning input amplitude -1 through +1, inclusive. */
export const DRIVE_SIZE = 257;

/** Dense transfer table handed directly to WaveShaperNode. */
export const DRIVE_CURVE_SIZE = 2049;

export type DrivePreset = "identity" | "soft" | "hard" | "asym";

export const DRIVE_PRESET_ORDER: DrivePreset[] = [
  "identity",
  "soft",
  "hard",
  "asym",
];

export const DRIVE_PRESET_LABEL: Record<DrivePreset, string> = {
  identity: "Identity",
  soft: "Soft",
  hard: "Hard",
  asym: "Asym",
};

export function clampTransfer(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

export function cloneTransfer(curve: number[]): number[] {
  return curve.slice();
}

export function transfersDiffer(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

/** Linear interpolation over an authored, non-wrapping transfer function. */
export function sampleTransfer(curve: ArrayLike<number>, input: number): number {
  const n = curve.length;
  if (n === 0) return clampTransfer(input);
  if (n === 1) return clampTransfer(curve[0] ?? 0);
  const x = ((Math.min(1, Math.max(-1, input)) + 1) * 0.5) * (n - 1);
  const i = Math.floor(x);
  const j = Math.min(n - 1, i + 1);
  const u = x - i;
  const a = clampTransfer(curve[i] ?? 0);
  const b = clampTransfer(curve[j] ?? 0);
  return clampTransfer(a + (b - a) * u);
}

export function buildDriveCurve(
  authored: ArrayLike<number>,
  size = DRIVE_CURVE_SIZE,
): Float32Array<ArrayBuffer> {
  const n = Math.max(2, Math.floor(size));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const input = (i / (n - 1)) * 2 - 1;
    out[i] = sampleTransfer(authored, input);
  }
  return out;
}

export function generateDrivePreset(kind: DrivePreset): number[] {
  const out = new Array<number>(DRIVE_SIZE);
  for (let i = 0; i < DRIVE_SIZE; i++) {
    const x = (i / (DRIVE_SIZE - 1)) * 2 - 1;
    switch (kind) {
      case "identity":
        out[i] = x;
        break;
      case "soft":
        out[i] = Math.tanh(1.8 * x) / Math.tanh(1.8);
        break;
      case "hard":
        out[i] = clampTransfer(x * 5.5);
        break;
      case "asym": {
        // Different positive/negative knees make this intentionally non-odd
        // while a silent input still maps to silence.
        const amount = x < 0 ? 2.8 : 1.35;
        const shaped = Math.tanh(amount * x) / Math.tanh(amount);
        out[i] = clampTransfer(shaped);
        break;
      }
    }
  }
  return out;
}

export function identifyDrivePreset(curve: number[]): DrivePreset | "custom" {
  for (const preset of DRIVE_PRESET_ORDER) {
    if (!transfersDiffer(curve, generateDrivePreset(preset))) return preset;
  }
  return "custom";
}

export function transferToPath(
  curve: ArrayLike<number>,
  width: number,
  height: number,
  stride = 4,
): string {
  const n = curve.length;
  if (n === 0) return "";
  const points: string[] = [];
  for (let i = 0; i < n; i += Math.max(1, stride)) {
    const x = (i / Math.max(1, n - 1)) * width;
    const y = (0.5 - clampTransfer(curve[i] ?? 0) * 0.5) * height;
    points.push(`${points.length === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  if ((n - 1) % Math.max(1, stride) !== 0) {
    const y = (0.5 - clampTransfer(curve[n - 1] ?? 0) * 0.5) * height;
    points.push(`L${width.toFixed(1)} ${y.toFixed(1)}`);
  }
  return points.join(" ");
}
