/** Drawing points for the normalized A/B motion trajectory. */
export const MOTION_SIZE = 512;

/** Fixed one-shot duration for MOTION v0. */
export const MOTION_SECONDS = 4;

export type MotionFrame = {
  progress: number;
  position: number;
  complete: boolean;
};

export function clampMotionValue(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function createDefaultMotionPath(size = MOTION_SIZE): number[] {
  const n = Math.max(2, Math.floor(size));
  return Array.from({ length: n }, (_, index) => index / (n - 1));
}

export function cloneMotionPath(path: number[]): number[] {
  return path.slice();
}

export function clampMotionPath(path: number[]): number[] {
  return path.map(clampMotionValue);
}

export function motionPathsDiffer(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

export function sampleMotionPath(path: number[], t01: number): number {
  const n = path.length;
  if (n === 0) return 0;
  const x = clampMotionValue(t01) * (n - 1);
  const i = Math.floor(x);
  const j = Math.min(n - 1, i + 1);
  const u = x - i;
  return clampMotionValue((path[i] ?? 0) * (1 - u) + (path[j] ?? 0) * u);
}

export function motionFrameAtTime(
  path: number[],
  elapsedSeconds: number,
  durationSeconds = MOTION_SECONDS,
): MotionFrame {
  const duration =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : MOTION_SECONDS;
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const progress = clampMotionValue(elapsed / duration);
  return {
    progress,
    position: sampleMotionPath(path, progress),
    complete: elapsed >= duration,
  };
}

/** Swap the meaning of the A/B coordinate system without changing its trajectory. */
export function complementMotionPath(path: number[]): number[] {
  return path.map((value) => 1 - clampMotionValue(value));
}
