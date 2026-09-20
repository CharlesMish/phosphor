/** Gesture coordinates include BOTH visible seams; storage has one periodic seam. */
export function cycleGestureIndex(phase: number, size: number): number {
  return Math.round(Math.min(1, Math.max(0, phase)) * size);
}

export function cycleSampleIndex(index: number, size: number): number {
  return ((index % size) + size) % size;
}

/** Interpolate in gesture space, wrapping only the individual buffer writes. */
export function paintCycleSpan(
  wave: number[], from: number, to: number, value: number,
): void {
  if (!wave.length) return;
  const start = wave[cycleSampleIndex(from, wave.length)] ?? value;
  const distance = Math.abs(to - from);
  if (!distance) {
    wave[cycleSampleIndex(to, wave.length)] = value;
    return;
  }
  const direction = Math.sign(to - from);
  for (let step = 0; step <= distance; step++) {
    wave[cycleSampleIndex(from + direction * step, wave.length)] =
      start + (value - start) * (step / distance);
  }
}
