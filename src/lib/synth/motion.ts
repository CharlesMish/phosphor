/** Drawing points for the normalized A/B motion trajectory. */
export const MOTION_SIZE = 512;

export const MOTION_BPM_MIN = 40;
export const MOTION_BPM_MAX = 240;
export const DEFAULT_MOTION_BPM = 120;

export const MOTION_BEAT_LENGTHS = [1, 2, 4, 8] as const;
export type MotionBeats = (typeof MOTION_BEAT_LENGTHS)[number];
export const DEFAULT_MOTION_BEATS: MotionBeats = 4;

export const MOTION_MODES = ["one-shot", "loop", "ping-pong"] as const;
export type MotionMode = (typeof MOTION_MODES)[number];
export const DEFAULT_MOTION_MODE: MotionMode = "one-shot";

export type MotionTiming = Readonly<{
  bpm: number;
  beats: MotionBeats;
  mode: MotionMode;
}>;

export const DEFAULT_MOTION_TIMING: MotionTiming = {
  bpm: DEFAULT_MOTION_BPM,
  beats: DEFAULT_MOTION_BEATS,
  mode: DEFAULT_MOTION_MODE,
};

export type MotionFrame = {
  progress: number;
  position: number;
  complete: boolean;
};

export function clampMotionValue(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function clampMotionBpm(value: number): number {
  const bpm = Number.isFinite(value) ? value : DEFAULT_MOTION_BPM;
  return Math.min(MOTION_BPM_MAX, Math.max(MOTION_BPM_MIN, bpm));
}

export function beatDurationSeconds(bpm: number): number {
  return 60 / clampMotionBpm(bpm);
}

export function motionDurationSeconds(bpm: number, beats: MotionBeats): number {
  return beatDurationSeconds(bpm) * beats;
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
  timing: MotionTiming = DEFAULT_MOTION_TIMING,
): MotionFrame {
  const duration = motionDurationSeconds(timing.bpm, timing.beats);
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const cycle = elapsed / duration;

  if (timing.mode === "one-shot") {
    const progress = clampMotionValue(cycle);
    return {
      progress,
      position: sampleMotionPath(path, progress),
      complete: elapsed >= duration,
    };
  }

  const phase = cycle - Math.floor(cycle);
  const progress =
    timing.mode === "ping-pong"
      ? phase <= 0.5
        ? phase * 2
        : (1 - phase) * 2
      : phase;
  return {
    progress,
    position: sampleMotionPath(path, progress),
    complete: false,
  };
}

/** Swap the meaning of the A/B coordinate system without changing its trajectory. */
export function complementMotionPath(path: number[]): number[] {
  return path.map((value) => 1 - clampMotionValue(value));
}
