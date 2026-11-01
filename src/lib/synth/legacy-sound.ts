import { WAVE_SIZE, type WavePreset } from "./waveform";
import { DRIVE_SIZE, DRIVE_SAFE_MAX_AMOUNT, clampDriveAmount, type DrivePreset } from "./drive";
import { CHORUS_SIZE, type ChorusPreset } from "./chorus";
import { SPACE_SIZE, clampSpaceSeconds, type SpacePreset } from "./space";
import {
  MOTION_BEAT_LENGTHS,
  MOTION_MODES,
  MOTION_SIZE,
  clampMotionBpm,
  type MotionBeats,
  type MotionMode,
} from "./motion";
import { clampMotionEndpoint, type MotionRoutes } from "./motion-routing";

/**
 * A saved Phosphor sound: every drawn shape and setting needed to rebuild what
 * the instrument plays. It deliberately excludes transient state (held notes,
 * undo history, Motion playback position, octave and the visual treatment).
 */
export const SOUND_FORMAT = "phosphor-sound";
export const SOUND_VERSION = 1;
export const SOUND_NAME_MAX = 80;

export type SoundSnapshot = {
  format: typeof SOUND_FORMAT;
  version: typeof SOUND_VERSION;
  name: string;
  savedAt: string;
  cycle: {
    samples: number[];
    preset: WavePreset | "custom";
    slotA: number[] | null;
    slotB: number[] | null;
    morph: number;
    /** True when the instrument is playing the A/B pair rather than `samples`. */
    morphLive: boolean;
  };
  voice: { attack: number; release: number; cutoff: number; volume: number };
  drive: { curve: number[]; preset: DrivePreset | "custom"; amount: number; safe: boolean };
  chorus: { curve: number[]; preset: ChorusPreset | "custom"; period: number; mix: number };
  space: {
    contour: number[];
    seed: number;
    preset: SpacePreset | "custom";
    metal: boolean;
    mix: number;
    seconds: number;
  };
  motion: {
    path: number[];
    bpm: number;
    beats: MotionBeats;
    mode: MotionMode;
    routes: MotionRoutes;
  };
};

/** The store fields a snapshot is made from (a structural subset of the synth store). */
export type SoundSource = {
  samples: number[];
  preset: WavePreset | "custom";
  slotA: number[] | null;
  slotB: number[] | null;
  morph: number;
  morphLive: boolean;
  attack: number;
  release: number;
  cutoff: number;
  volume: number;
  driveCurve: number[];
  drivePreset: DrivePreset | "custom";
  driveAmount: number;
  driveSafe: boolean;
  chorusCurve: number[];
  chorusPreset: ChorusPreset | "custom";
  chorusPeriod: number;
  chorusMix: number;
  spaceContour: number[];
  spaceSeed: number;
  spacePreset: SpacePreset | "custom";
  spaceMetal: boolean;
  spaceMix: number;
  spaceSeconds: number;
  motionPath: number[];
  motionBpm: number;
  motionBeats: MotionBeats;
  motionMode: MotionMode;
  motionRoutes: MotionRoutes;
};

const WAVE_PRESETS = ["sine", "triangle", "saw", "square", "wild"] as const;
const DRIVE_PRESETS = ["identity", "soft", "hard", "asym"] as const;
const CHORUS_PRESETS = ["sine", "triangle", "rise", "wild"] as const;
const SPACE_PRESETS = ["room", "long", "echo", "reverse", "metal"] as const;

export const VOICE_LIMITS = {
  attack: [0.004, 0.8],
  release: [0.03, 2.2],
  cutoff: [0, 1],
  volume: [0, 1],
} as const;
export const CHORUS_PERIOD_LIMITS = [0.25, 4] as const;

export function cleanSoundName(name: unknown): string {
  const text = typeof name === "string" ? name.replace(/\s+/g, " ").trim() : "";
  return (text || "Untitled sound").slice(0, SOUND_NAME_MAX);
}

export function snapshotSound(source: SoundSource, name: string, savedAt = new Date()): SoundSnapshot {
  return {
    format: SOUND_FORMAT,
    version: SOUND_VERSION,
    name: cleanSoundName(name),
    savedAt: savedAt.toISOString(),
    cycle: {
      samples: source.samples.slice(),
      preset: source.preset,
      slotA: source.slotA ? source.slotA.slice() : null,
      slotB: source.slotB ? source.slotB.slice() : null,
      morph: source.morph,
      morphLive: source.morphLive && Boolean(source.slotA && source.slotB),
    },
    voice: {
      attack: source.attack,
      release: source.release,
      cutoff: source.cutoff,
      volume: source.volume,
    },
    drive: {
      curve: source.driveCurve.slice(),
      preset: source.drivePreset,
      amount: source.driveAmount,
      safe: source.driveSafe,
    },
    chorus: {
      curve: source.chorusCurve.slice(),
      preset: source.chorusPreset,
      period: source.chorusPeriod,
      mix: source.chorusMix,
    },
    space: {
      contour: source.spaceContour.slice(),
      seed: source.spaceSeed,
      preset: source.spacePreset,
      metal: source.spaceMetal,
      mix: source.spaceMix,
      seconds: source.spaceSeconds,
    },
    motion: {
      path: source.motionPath.slice(),
      bpm: source.motionBpm,
      beats: source.motionBeats,
      mode: source.motionMode,
      routes: structuredClone(source.motionRoutes) as MotionRoutes,
    },
  };
}

export class SoundFileError extends Error {}

type Obj = Record<string, unknown>;

function fail(message: string): never {
  throw new SoundFileError(message);
}
function object(value: unknown, where: string): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${where} is missing.`);
  return value as Obj;
}
function finite(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${where} must be a number.`);
  return value;
}
function inRange(value: unknown, lo: number, hi: number, where: string): number {
  const n = finite(value, where);
  if (n < lo || n > hi) fail(`${where} is out of range.`);
  return n;
}
function bool(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") fail(`${where} must be true or false.`);
  return value;
}
function oneOf<T extends string>(value: unknown, options: readonly T[], where: string): T {
  if (typeof value !== "string" || !(options as readonly string[]).includes(value)) fail(`${where} is not recognised.`);
  return value as T;
}
function curve(value: unknown, size: number, lo: number, hi: number, where: string): number[] {
  if (!Array.isArray(value) || value.length !== size) fail(`${where} must have ${size} points.`);
  return value.map((v, i) => inRange(v, lo, hi, `${where}[${i}]`));
}

/**
 * Validates untrusted JSON (a file or browser storage) and returns a fresh
 * snapshot. Values outside the instrument's own ranges are rejected rather
 * than silently clamped, so a reopened sound is either exact or refused.
 */
export function parseSound(input: unknown): SoundSnapshot {
  const root = object(input, "Sound");
  if (root.format !== SOUND_FORMAT) fail("This is not a Phosphor sound file.");
  if (root.version !== SOUND_VERSION) fail(`Unsupported Phosphor sound version ${String(root.version)}.`);
  const savedAt = typeof root.savedAt === "string" && !Number.isNaN(Date.parse(root.savedAt))
    ? root.savedAt : fail("Saved time is missing.");

  const c = object(root.cycle, "Cycle");
  const slot = (value: unknown, where: string) =>
    value === null ? null : curve(value, WAVE_SIZE, -1, 1, where);
  const cycle = {
    samples: curve(c.samples, WAVE_SIZE, -1, 1, "Cycle"),
    preset: oneOf(c.preset, [...WAVE_PRESETS, "custom"] as const, "Cycle preset"),
    slotA: slot(c.slotA, "Cycle A"),
    slotB: slot(c.slotB, "Cycle B"),
    morph: inRange(c.morph, 0, 1, "Morph"),
    morphLive: bool(c.morphLive, "Morph state"),
  };
  if (cycle.morphLive && !(cycle.slotA && cycle.slotB)) fail("Morph needs both A and B.");

  const v = object(root.voice, "Voice");
  const voice = {
    attack: inRange(v.attack, ...VOICE_LIMITS.attack, "Attack"),
    release: inRange(v.release, ...VOICE_LIMITS.release, "Release"),
    cutoff: inRange(v.cutoff, ...VOICE_LIMITS.cutoff, "Low-pass"),
    volume: inRange(v.volume, ...VOICE_LIMITS.volume, "Volume"),
  };

  const d = object(root.drive, "Drive");
  const safe = bool(d.safe, "Drive Safe");
  const amount = inRange(d.amount, 0, 1, "Drive amount");
  if (clampDriveAmount(amount) !== amount || (safe && amount > DRIVE_SAFE_MAX_AMOUNT + 1e-12)) {
    fail("Drive amount is out of range.");
  }
  const drive = {
    curve: curve(d.curve, DRIVE_SIZE, -1, 1, "Drive"),
    preset: oneOf(d.preset, [...DRIVE_PRESETS, "custom"] as const, "Drive preset"),
    amount,
    safe,
  };

  const ch = object(root.chorus, "Chorus");
  const chorus = {
    curve: curve(ch.curve, CHORUS_SIZE, -1, 1, "Chorus"),
    preset: oneOf(ch.preset, [...CHORUS_PRESETS, "custom"] as const, "Chorus preset"),
    period: inRange(ch.period, ...CHORUS_PERIOD_LIMITS, "Chorus period"),
    mix: inRange(ch.mix, 0, 1, "Chorus mix"),
  };

  const s = object(root.space, "Space");
  const seed = finite(s.seed, "Space seed");
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) fail("Space seed is out of range.");
  const seconds = finite(s.seconds, "Space length");
  if (clampSpaceSeconds(seconds) !== seconds) fail("Space length is out of range.");
  const space = {
    contour: curve(s.contour, SPACE_SIZE, 0, 1, "Space"),
    seed,
    preset: oneOf(s.preset, [...SPACE_PRESETS, "custom"] as const, "Space preset"),
    metal: bool(s.metal, "Space Metal"),
    mix: inRange(s.mix, 0, 1, "Space mix"),
    seconds,
  };

  const m = object(root.motion, "Motion");
  const bpm = finite(m.bpm, "BPM");
  if (clampMotionBpm(bpm) !== bpm) fail("BPM is out of range.");
  const beats = finite(m.beats, "Motion length") as MotionBeats;
  if (!MOTION_BEAT_LENGTHS.includes(beats)) fail("Motion length is not recognised.");
  const r = object(m.routes, "Motion routes");
  const rc = object(r.cycle, "Cycle route");
  const numeric = (id: "driveAmount" | "chorusMix" | "spaceMix") => {
    const route = object(r[id], `${id} route`);
    const from = finite(route.from, `${id} from`);
    const to = finite(route.to, `${id} to`);
    if (clampMotionEndpoint(id, from) !== from || clampMotionEndpoint(id, to) !== to) fail(`${id} range is out of range.`);
    return { enabled: bool(route.enabled, `${id} enabled`), from, to };
  };
  const motion = {
    path: curve(m.path, MOTION_SIZE, 0, 1, "Motion"),
    bpm,
    beats,
    mode: oneOf(m.mode, MOTION_MODES, "Motion mode"),
    routes: {
      cycle: { enabled: bool(rc.enabled, "Cycle route"), inverted: bool(rc.inverted, "Cycle route direction") },
      driveAmount: numeric("driveAmount"),
      chorusMix: numeric("chorusMix"),
      spaceMix: numeric("spaceMix"),
    },
  };

  return {
    format: SOUND_FORMAT,
    version: SOUND_VERSION,
    name: cleanSoundName(root.name),
    savedAt,
    cycle,
    voice,
    drive,
    chorus,
    space,
    motion,
  };
}

/** Parses text from a `.phosphor.json` file or storage. */
export function parseSoundText(text: string): SoundSnapshot {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SoundFileError("This file is not valid JSON.");
  }
  return parseSound(data);
}

export function soundFileName(name: string): string {
  const base = cleanSoundName(name).replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") || "sound";
  return `${base.slice(0, 60)}.phosphor.json`;
}
