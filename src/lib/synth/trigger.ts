/**
 * Hysteretic rising-zero trigger for a time-domain scope.
 *
 * Arm when the signal goes below a negative threshold, then fire on the
 * first later sample that crosses from < 0 to >= 0. The arm and the
 * crossing may be many samples apart — required for quiet sines, where
 * the rise from −hyst to zero spans several samples.
 */
export function findRisingZero(
  buf: ArrayLike<number>,
  peak = 0,
): number {
  const n = buf.length;
  if (n < 4) return 0;
  const hyst = Math.max(0.012, (peak > 0 ? peak : 0.08) * 0.25);
  const search = Math.max(4, n - 4);

  let armed = (buf[0] ?? 0) <= -hyst;
  for (let i = 1; i < search; i++) {
    const v = buf[i] ?? 0;
    if (!armed) {
      if (v <= -hyst) armed = true;
      continue;
    }
    const prev = buf[i - 1] ?? 0;
    if (prev < 0 && v >= 0) {
      let ahead = 0;
      const last = Math.min(n, i + 6);
      for (let k = i; k < last; k++) ahead += buf[k] ?? 0;
      if (ahead >= 0) return i;
    }
  }
  return 0;
}
