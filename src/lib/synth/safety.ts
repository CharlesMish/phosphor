export const OUTPUT_SAFETY_THRESHOLD = 0.85;
export const OUTPUT_SAFETY_CEILING = 0.98;
const OUTPUT_SAFETY_CURVE_SIZE = 65537;

/**
 * Identity below the safety threshold, then a C1-continuous bend to a fixed
 * ceiling. Unlike a time-domain compressor this cannot pump or add makeup gain.
 */
export function buildOutputSafetyCurve(
  size = OUTPUT_SAFETY_CURVE_SIZE,
): Float32Array<ArrayBuffer> {
  const n = Math.max(3, size | 1);
  const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT));
  const span = 1 - OUTPUT_SAFETY_THRESHOLD;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const sign = x < 0 ? -1 : 1;
    const a = Math.abs(x);
    if (a <= OUTPUT_SAFETY_THRESHOLD) {
      curve[i] = x;
      continue;
    }

    const u = Math.min(1, (a - OUTPUT_SAFETY_THRESHOLD) / span);
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const y =
      h00 * OUTPUT_SAFETY_THRESHOLD +
      h10 * span +
      h01 * OUTPUT_SAFETY_CEILING;
    curve[i] = sign * y;
  }
  return curve;
}
