import { cycleMorphSamples } from "./engine";
import { parseSound as parseLegacySound } from "./legacy-sound";
import { parseSessionDocument, SESSION_VERSION, type SessionDocument } from "./session-file";

/** Same sound family as PR #15. v2 separates workspace and catalogue fields. */
export const SOUND_FORMAT = "phosphor-sound";
export const SOUND_VERSION = 2;
export const SOUND_ENGINE = "phosphor-periodic-1";
export const SOUND_NORMALIZATION = "dc-remove-peak-0.9-endpoints-linear-blend";
export const MAX_PACK_BYTES = 4_000_000;
export type SoundDocument = {
  format: typeof SOUND_FORMAT;
  version: typeof SOUND_VERSION;
  engine: typeof SOUND_ENGINE;
  normalization: typeof SOUND_NORMALIZATION;
  cycle: Omit<SessionDocument["cycle"], "hasDrawn">;
  voice: { attack: number; release: number; cutoff: number; trimDb: number };
  drive: Omit<SessionDocument["drive"], "hasDrawn">;
  chorus: SessionDocument["chorus"];
  space: Omit<SessionDocument["space"], "hasDrawn">;
  motion: Omit<SessionDocument["motion"], "bpm">;
};

export function exactObject(input: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${label} must be an object.`);
  const obj = input as Record<string, unknown>;
  if (Object.keys(obj).length !== keys.length || keys.some(k => !Object.hasOwn(obj, k))) {
    throw new Error(`${label} contains missing or unsupported fields.`);
  }
  return obj;
}

/** Reuse the session validator and production interpretation, not another DSP parser. */
export function soundToSession(sound: SoundDocument, workspace: SessionDocument): SessionDocument {
  const { trimDb, cutoff, attack, release } = sound.voice;
  return parseSessionDocument({
    ...workspace,
    version: SESSION_VERSION,
    cycle: { ...sound.cycle, hasDrawn: true },
    envelope: { attack, release }, filter: { cutoff },
    output: { ...workspace.output, trimDb },
    drive: { ...sound.drive, hasDrawn: true },
    chorus: sound.chorus,
    space: { ...sound.space, hasDrawn: true },
    motion: { ...sound.motion, bpm: workspace.motion.bpm },
  });
}

// This supplies only workspace fields to the shared validator; no defaults for DSP data.
const validationWorkspace = {
  format: "phosphor-session", version: SESSION_VERSION, domain: "cycle",
  output: { volume: 0.72, octave: 0, trimDb: 0 },
  motion: { bpm: 120 }, noteLoop: { bars: 1, events: [] },
} as unknown as SessionDocument;

export function soundFromSession(session: SessionDocument): SoundDocument {
  const s = parseSessionDocument(session);
  const { hasDrawn: _c, ...cycle } = s.cycle;
  const { hasDrawn: _d, ...drive } = s.drive;
  const { hasDrawn: _s, ...space } = s.space;
  const { bpm: _b, ...motion } = s.motion;
  // The workspace starts with a dormant Cycle route before A/B exist. A sound
  // export records effective routing rather than promising missing endpoints.
  if (!cycle.slotA || !cycle.slotB) motion.routes = { ...motion.routes, cycle: { ...motion.routes.cycle, enabled: false } };
  return {
    format: SOUND_FORMAT, version: SOUND_VERSION, engine: SOUND_ENGINE,
    normalization: SOUND_NORMALIZATION, cycle, drive, space, motion, chorus: s.chorus,
    voice: { ...s.envelope, cutoff: s.filter.cutoff, trimDb: s.output.trimDb },
  };
}

function validateLegacyShape(input: unknown) {
  const r = exactObject(input, ["format", "version", "name", "savedAt", "cycle", "voice", "drive", "chorus", "space", "motion"], "Legacy sound");
  exactObject(r.cycle, ["samples", "preset", "slotA", "slotB", "morph", "morphLive"], "Cycle");
  exactObject(r.voice, ["attack", "release", "cutoff", "volume"], "Voice");
  exactObject(r.drive, ["curve", "preset", "amount", "safe"], "Drive");
  exactObject(r.chorus, ["curve", "preset", "period", "mix"], "Chorus");
  exactObject(r.space, ["contour", "seed", "preset", "metal", "mix", "seconds"], "Space");
  const m = exactObject(r.motion, ["path", "bpm", "beats", "mode", "routes"], "Motion");
  const routes = exactObject(m.routes, ["cycle", "driveAmount", "chorusMix", "spaceMix"], "Motion routes");
  exactObject(routes.cycle, ["enabled", "inverted"], "Cycle route");
  for (const k of ["driveAmount", "chorusMix", "spaceMix"]) exactObject(routes[k], ["enabled", "from", "to"], k);
}

export function parseSound(input: unknown): SoundDocument {
  if ((input as { version?: unknown })?.version === 1) {
    validateLegacyShape(input);
    const legacy = parseLegacySound(input);
    const { volume: _monitor, ...voice } = legacy.voice;
    const { bpm: _tempo, ...motion } = legacy.motion;
    const cycle = legacy.cycle;
    if (!cycle.slotA || !cycle.slotB) motion.routes = { ...motion.routes, cycle: { ...motion.routes.cycle, enabled: false } };
    // v1 accepted a stale display cycle in morph mode. Endpoints were the audio authority.
    if (cycle.morphLive) cycle.samples = cycleMorphSamples(cycle.slotA!, cycle.slotB!, cycle.morph);
    return parseSound({
      format: SOUND_FORMAT, version: SOUND_VERSION, engine: SOUND_ENGINE,
      normalization: SOUND_NORMALIZATION, cycle, voice: { ...voice, trimDb: 0 },
      drive: legacy.drive, chorus: legacy.chorus, space: legacy.space, motion,
    });
  }
  const r = exactObject(input, ["format", "version", "engine", "normalization", "cycle", "voice", "drive", "chorus", "space", "motion"], "Sound");
  if (r.format !== SOUND_FORMAT || r.version !== SOUND_VERSION) throw new Error("Unsupported sound schema.");
  if (r.engine !== SOUND_ENGINE || r.normalization !== SOUND_NORMALIZATION) throw new Error("Unsupported engine or wave normalization.");
  exactObject(r.voice, ["attack", "release", "cutoff", "trimDb"], "Voice");
  exactObject(r.cycle, ["samples", "preset", "slotA", "slotB", "morph", "morphLive"], "Cycle");
  exactObject(r.drive, ["curve", "preset", "amount", "safe"], "Drive");
  exactObject(r.space, ["contour", "seed", "preset", "metal", "mix", "seconds"], "Space");
  exactObject(r.motion, ["path", "mode", "beats", "routes"], "Motion");
  const validated = soundToSession(r as unknown as SoundDocument, validationWorkspace);
  if (validated.motion.routes.cycle.enabled && (!validated.cycle.slotA || !validated.cycle.slotB)) {
    throw new Error("Cycle Motion requires both A and B endpoints.");
  }
  return soundFromSession(validated);
}

export function parseJsonFile(text: string): unknown {
  if (new TextEncoder().encode(text).length > MAX_PACK_BYTES) throw new Error("File exceeds 4 MB.");
  return JSON.parse(text);
}
