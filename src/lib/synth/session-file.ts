import { CHORUS_SIZE, type ChorusPreset } from "./chorus";
import { DRIVE_SAFE_MAX_AMOUNT, DRIVE_SIZE, type DrivePreset } from "./drive";
import { cycleMorphSamples } from "./engine";
import {
  MOTION_BEAT_LENGTHS,
  MOTION_BPM_MAX,
  MOTION_BPM_MIN,
  MOTION_MODES,
  MOTION_SIZE,
  type MotionBeats,
  type MotionMode,
} from "./motion";
import { motionRouteLimit } from "./motion-routing";
import { LOOP_BARS, type LoopBars, type NoteEvent } from "./note-looper";
import {
  SPACE_MAX_SECONDS,
  SPACE_MIN_SECONDS,
  SPACE_SIZE,
  type SpacePreset,
} from "./space";
import { WAVE_SIZE, type WavePreset } from "./waveform";

export const SESSION_FORMAT = "phosphor-session";
export const SESSION_VERSION = 2;
export const SESSION_STORAGE_KEY = "phosphor.session.v2";
export const SESSION_EVENT_LIMIT = 4096;

const DOMAINS = ["cycle", "motion", "drive", "chorus", "space"] as const;
const WAVE_PRESETS = ["sine", "triangle", "saw", "square", "wild", "custom"] as const;
const DRIVE_PRESETS = ["identity", "soft", "hard", "asym", "custom"] as const;
const CHORUS_PRESETS = ["sine", "triangle", "rise", "wild", "custom"] as const;
const SPACE_PRESETS = ["room", "long", "echo", "reverse", "metal", "custom"] as const;

export type SessionDomain = (typeof DOMAINS)[number];

export type SessionDocument = {
  format: typeof SESSION_FORMAT;
  version: typeof SESSION_VERSION;
  domain: SessionDomain;
  cycle: {
    samples: number[];
    preset: WavePreset | "custom";
    hasDrawn: boolean;
    slotA: number[] | null;
    slotB: number[] | null;
    morph: number;
    morphLive: boolean;
  };
  envelope: { attack: number; release: number };
  filter: { cutoff: number };
  output: { volume: number; octave: number; trimDb: number };
  drive: {
    curve: number[];
    preset: DrivePreset | "custom";
    amount: number;
    safe: boolean;
    hasDrawn: boolean;
  };
  chorus: {
    curve: number[];
    preset: ChorusPreset | "custom";
    period: number;
    mix: number;
  };
  space: {
    contour: number[];
    seed: number;
    preset: SpacePreset | "custom";
    metal: boolean;
    mix: number;
    seconds: number;
    hasDrawn: boolean;
  };
  motion: {
    path: number[];
    mode: MotionMode;
    bpm: number;
    beats: MotionBeats;
    routes: {
      cycle: { enabled: boolean; inverted: boolean };
      driveAmount: { enabled: boolean; from: number; to: number };
      chorusMix: { enabled: boolean; from: number; to: number };
      spaceMix: { enabled: boolean; from: number; to: number };
    };
  };
  noteLoop: {
    bars: LoopBars;
    events: NoteEvent[];
  };
};

export class SessionFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionFileError";
  }
}

function fail(message: string): never {
  throw new SessionFileError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} is missing.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const present = Object.keys(value);
  if (present.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    fail(`${label} has an unexpected shape.`);
  }
}

function booleanAt(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} is missing.`);
  return value;
}

function numberIn(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label} is outside the instrument range.`);
  }
  return value;
}

function integerIn(value: unknown, min: number, max: number, label: string): number {
  const number = numberIn(value, min, max, label);
  if (!Number.isInteger(number)) fail(`${label} must be an integer.`);
  return number;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) fail(`${label} is unsupported.`);
  return value as T;
}

function curve(value: unknown, length: number, min: number, max: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== length) fail(`${label} has the wrong length.`);
  return value.map((sample, index) => numberIn(sample, min, max, `${label} sample ${index}`));
}

function slot(value: unknown, label: string): number[] | null {
  if (value === null) return null;
  return curve(value, WAVE_SIZE, -1, 1, label);
}

function sameCurve(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function numericRoute(
  value: unknown,
  id: "driveAmount" | "chorusMix" | "spaceMix",
  label: string,
): { enabled: boolean; from: number; to: number } {
  const route = record(value, label);
  exactKeys(route, ["enabled", "from", "to"], label);
  const limit = motionRouteLimit(id);
  return {
    enabled: booleanAt(route.enabled, `${label} enabled`),
    from: numberIn(route.from, 0, limit, `${label} from`),
    to: numberIn(route.to, 0, limit, `${label} to`),
  };
}

function noteEvents(value: unknown, bars: LoopBars): NoteEvent[] {
  if (!Array.isArray(value) || value.length > SESSION_EVENT_LIMIT) {
    fail("Note events are missing or too long.");
  }
  const boundary = bars * 4;
  const events: NoteEvent[] = value.map((entry, index) => {
    const event = record(entry, `Note event ${index}`);
    exactKeys(event, ["id", "type", "midi", "beat"], `Note event ${index}`);
    const type = event.type;
    if (type !== "on" && type !== "off") fail(`Note event ${index} has an unsupported type.`);
    return {
      id: integerIn(event.id, 0, 1_000_000, `Note event ${index} id`),
      type,
      midi: integerIn(event.midi, 0, 127, `Note event ${index} midi`),
      beat: numberIn(event.beat, 0, boundary, `Note event ${index} beat`),
    };
  });
  const pairs = new Map<number, { on?: number; off?: number; midi?: number }>();
  for (const event of events) {
    const pair = pairs.get(event.id) ?? {};
    if (pair.midi !== undefined && pair.midi !== event.midi) fail("Paired notes disagree on pitch.");
    pair.midi = event.midi;
    if (event.type === "on") {
      if (pair.on !== undefined) fail("A note repeats its note-on.");
      pair.on = event.beat;
    } else {
      if (pair.off !== undefined) fail("A note repeats its note-off.");
      pair.off = event.beat;
    }
    pairs.set(event.id, pair);
  }
  for (const pair of pairs.values()) {
    if (pair.on === undefined) fail("A note-off has no note-on.");
    if (pair.off !== undefined && pair.off < pair.on) fail("A note-off precedes its note-on.");
  }
  return events;
}

/**
 * Parse and validate a portable session. Throws before returning when the
 * document is malformed or outside the instrument's ranges. Callers must not
 * apply anything until this returns.
 */
export function parseSessionDocument(input: unknown): SessionDocument {
  let root = record(input, "Session");
  // v1 had no authored output trim. Its monitor volume remains a workspace setting.
  if (root.format === SESSION_FORMAT && root.version === 1) {
    const output = record(root.output, "Output");
    exactKeys(output, ["volume", "octave"], "Output");
    root = { ...root, version: SESSION_VERSION, output: { ...output, trimDb: 0 } };
  }
  exactKeys(root, [
    "format", "version", "domain", "cycle", "envelope", "filter", "output",
    "drive", "chorus", "space", "motion", "noteLoop",
  ], "Session");
  if (root.format !== SESSION_FORMAT) fail("This file is not a Phosphor session.");
  if (root.version !== SESSION_VERSION) fail("This session version is unsupported.");

  const cycleIn = record(root.cycle, "Cycle");
  exactKeys(cycleIn, ["samples", "preset", "hasDrawn", "slotA", "slotB", "morph", "morphLive"], "Cycle");
  const cycle = {
    samples: curve(cycleIn.samples, WAVE_SIZE, -1, 1, "Cycle"),
    preset: oneOf(cycleIn.preset, WAVE_PRESETS, "Cycle preset"),
    hasDrawn: booleanAt(cycleIn.hasDrawn, "Cycle drawn"),
    slotA: slot(cycleIn.slotA, "Cycle A"),
    slotB: slot(cycleIn.slotB, "Cycle B"),
    morph: numberIn(cycleIn.morph, 0, 1, "Morph"),
    morphLive: booleanAt(cycleIn.morphLive, "Morph live"),
  };
  if (cycle.morphLive) {
    if (!cycle.slotA || !cycle.slotB) fail("A live morph needs both Cycle A and Cycle B.");
    const blend = cycleMorphSamples(cycle.slotA, cycle.slotB, cycle.morph);
    if (!sameCurve(blend, cycle.samples)) fail("The saved cycle does not match its A/B morph.");
  }

  const envelopeIn = record(root.envelope, "Envelope");
  exactKeys(envelopeIn, ["attack", "release"], "Envelope");
  const filterIn = record(root.filter, "Filter");
  exactKeys(filterIn, ["cutoff"], "Filter");
  const outputIn = record(root.output, "Output");
  exactKeys(outputIn, ["volume", "octave", "trimDb"], "Output");
  const driveIn = record(root.drive, "Drive");
  exactKeys(driveIn, ["curve", "preset", "amount", "safe", "hasDrawn"], "Drive");
  const drive = {
    curve: curve(driveIn.curve, DRIVE_SIZE, -1, 1, "Drive"),
    preset: oneOf(driveIn.preset, DRIVE_PRESETS, "Drive preset"),
    amount: numberIn(driveIn.amount, 0, 1, "Drive amount"),
    safe: booleanAt(driveIn.safe, "Drive safe"),
    hasDrawn: booleanAt(driveIn.hasDrawn, "Drive drawn"),
  };
  if (drive.safe && drive.amount > DRIVE_SAFE_MAX_AMOUNT) {
    fail("Drive amount is outside the Safe range.");
  }

  const chorusIn = record(root.chorus, "Chorus");
  exactKeys(chorusIn, ["curve", "preset", "period", "mix"], "Chorus");
  const spaceIn = record(root.space, "Space");
  exactKeys(spaceIn, ["contour", "seed", "preset", "metal", "mix", "seconds", "hasDrawn"], "Space");
  const motionIn = record(root.motion, "Motion");
  exactKeys(motionIn, ["path", "mode", "bpm", "beats", "routes"], "Motion");
  const routesIn = record(motionIn.routes, "Motion routes");
  exactKeys(routesIn, ["cycle", "driveAmount", "chorusMix", "spaceMix"], "Motion routes");
  const cycleRoute = record(routesIn.cycle, "Cycle route");
  exactKeys(cycleRoute, ["enabled", "inverted"], "Cycle route");
  const loopIn = record(root.noteLoop, "Note loop");
  exactKeys(loopIn, ["bars", "events"], "Note loop");
  const beats = integerIn(motionIn.beats, 1, 8, "Motion length") as MotionBeats;
  if (!MOTION_BEAT_LENGTHS.includes(beats)) fail("Motion length is unsupported.");
  const bars = integerIn(loopIn.bars, 1, 8, "Note loop length") as LoopBars;
  if (!LOOP_BARS.includes(bars)) fail("Note loop length is unsupported.");

  const document: SessionDocument = {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    domain: oneOf(root.domain, DOMAINS, "Editor"),
    cycle,
    envelope: {
      attack: numberIn(envelopeIn.attack, 0.004, 0.8, "Attack"),
      release: numberIn(envelopeIn.release, 0.03, 2.2, "Release"),
    },
    filter: { cutoff: numberIn(filterIn.cutoff, 0, 1, "Low-pass") },
    output: {
      trimDb: numberIn(outputIn.trimDb, -48, 0, "Sound trim"),
      volume: numberIn(outputIn.volume, 0, 1, "Volume"),
      octave: integerIn(outputIn.octave, -2, 3, "Octave"),
    },
    drive,
    chorus: {
      curve: curve(chorusIn.curve, CHORUS_SIZE, -1, 1, "Chorus"),
      preset: oneOf(chorusIn.preset, CHORUS_PRESETS, "Chorus preset"),
      period: numberIn(chorusIn.period, 0.25, 4, "Chorus period"),
      mix: numberIn(chorusIn.mix, 0, 1, "Chorus mix"),
    },
    space: {
      contour: curve(spaceIn.contour, SPACE_SIZE, 0, 1, "Space"),
      seed: integerIn(spaceIn.seed, 0, 0xffffffff, "Space seed"),
      preset: oneOf(spaceIn.preset, SPACE_PRESETS, "Space preset"),
      metal: booleanAt(spaceIn.metal, "Space metal"),
      mix: numberIn(spaceIn.mix, 0, 1, "Space mix"),
      seconds: numberIn(spaceIn.seconds, SPACE_MIN_SECONDS, SPACE_MAX_SECONDS, "Space length"),
      hasDrawn: booleanAt(spaceIn.hasDrawn, "Space drawn"),
    },
    motion: {
      path: curve(motionIn.path, MOTION_SIZE, 0, 1, "Motion"),
      mode: oneOf(motionIn.mode, MOTION_MODES, "Motion mode"),
      bpm: numberIn(motionIn.bpm, MOTION_BPM_MIN, MOTION_BPM_MAX, "Tempo"),
      beats,
      routes: {
        cycle: {
          enabled: booleanAt(cycleRoute.enabled, "Cycle route enabled"),
          inverted: booleanAt(cycleRoute.inverted, "Cycle route inverted"),
        },
        driveAmount: numericRoute(routesIn.driveAmount, "driveAmount", "Drive route"),
        chorusMix: numericRoute(routesIn.chorusMix, "chorusMix", "Chorus route"),
        spaceMix: numericRoute(routesIn.spaceMix, "spaceMix", "Space route"),
      },
    },
    noteLoop: {
      bars,
      events: noteEvents(loopIn.events, bars),
    },
  };
  return document;
}

export function serializeSession(document: SessionDocument): string {
  return JSON.stringify(document);
}
