import { exactObject, parseSound, type SoundDocument } from "./sound-file";
import { MOTION_BPM_MIN, MOTION_BPM_MAX } from "./motion";

export const ROLES = ["bass", "keys", "lead", "pad", "short-note/sequence", "texture", "wildcard"] as const;
export type Role = typeof ROLES[number];
export const CHARACTER = {
  brightness: ["dark", "balanced", "bright"],
  body: ["lean", "rounded", "full/warm"],
  attack: ["soft", "rounded", "hard/clicky"],
  texture: ["smooth", "grainy", "rough/buzzy"],
  motion: ["still", "slowly evolving", "rhythmic"],
  space: ["dry/close", "room", "spacious"],
  width: ["mono", "narrow", "wide"],
} as const;
export type Character = { [K in keyof typeof CHARACTER]: typeof CHARACTER[K][number] };
export type PresetMetadata = {
  name: string;
  contributor: string;
  provenance: string;
  roles: Role[];
  tags: string[];
  character: Character;
  range: [number, number];
  playing: "sustained" | "short-note" | "both";
  release: string;
  tryThis: string;
  recommendedBpm: number | null;
  validation: "authored-unheard" | "listening-reviewed";
  // Explicitly separate evidence from author intent (character and instructions).
  measurements: string[];
  listeningNotes: string[];
};
export type PresetEntry = { id: string; version: number; metadata: PresetMetadata; sound: SoundDocument };
export type PresetPack = { format: "phosphor-preset-pack"; version: 1; namespace: string; entries: PresetEntry[] };
export const PACK_LIMIT = 48;
const slug = /^[a-z][a-z0-9-]{1,47}$/;

function text(value: unknown, label: string, max = 300): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} must be 1–${max} characters.`);
  return value.trim();
}
function strings(value: unknown, label: string, max = 16): string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} has too many entries.`);
  return value.map(v => text(v, label));
}
function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (!choices.includes(value as T)) throw new Error(`Unsupported ${label}.`);
  return value as T;
}

export function parseEntry(input: unknown): PresetEntry {
  const e = exactObject(input, ["id", "version", "metadata", "sound"], "Preset");
  const id = text(e.id, "ID", 100);
  if (id.split(":").length !== 2 || !id.split(":").every(part => slug.test(part))) throw new Error("ID must be namespace:slug.");
  if (!Number.isSafeInteger(e.version) || (e.version as number) < 1) throw new Error("Preset version must be a positive integer.");
  const m = exactObject(e.metadata, ["name", "contributor", "provenance", "roles", "tags", "character", "range", "playing", "release", "tryThis", "recommendedBpm", "validation", "measurements", "listeningNotes"], "Metadata");
  const roles = strings(m.roles, "Roles", ROLES.length).map(r => choice(r, ROLES, "role"));
  if (!roles.length || new Set(roles).size !== roles.length) throw new Error("Use one or more distinct roles.");
  const raw = exactObject(m.character, Object.keys(CHARACTER), "Character");
  const character = Object.fromEntries(Object.entries(CHARACTER).map(([k, options]) => [k, choice(raw[k], options, k)])) as Character;
  if (!Array.isArray(m.range) || m.range.length !== 2 || !m.range.every(n => Number.isInteger(n) && n >= 0 && n <= 127) || m.range[0] > m.range[1]) throw new Error("Range must be two ordered MIDI notes.");
  if (m.recommendedBpm !== null && (typeof m.recommendedBpm !== "number" || !Number.isFinite(m.recommendedBpm) || m.recommendedBpm < MOTION_BPM_MIN || m.recommendedBpm > MOTION_BPM_MAX)) throw new Error("Recommended tempo is out of range.");
  return {
    id, version: e.version as number, sound: parseSound(e.sound),
    metadata: {
      name: text(m.name, "Name", 80), contributor: text(m.contributor, "Contributor", 100),
      provenance: text(m.provenance, "Provenance"), roles, tags: strings(m.tags, "Tags"), character,
      range: [m.range[0], m.range[1]], playing: choice(m.playing, ["sustained", "short-note", "both"], "playing style"),
      release: text(m.release, "Release"), tryThis: text(m.tryThis, "Try this"), recommendedBpm: m.recommendedBpm as number | null,
      validation: choice(m.validation, ["authored-unheard", "listening-reviewed"], "validation status"),
      measurements: strings(m.measurements, "Measurements"), listeningNotes: strings(m.listeningNotes, "Listening notes"),
    },
  };
}

/** Neutral stable label. Creator and evocative name never appear in blind labels. */
export function auditionId(id: string): string {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `P-${(h >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

export function parsePack(input: unknown): PresetPack {
  const p = exactObject(input, ["format", "version", "namespace", "entries"], "Pack");
  if (p.format !== "phosphor-preset-pack" || p.version !== 1) throw new Error("Unsupported preset pack.");
  if (typeof p.namespace !== "string" || !slug.test(p.namespace)) throw new Error("Invalid pack namespace.");
  if (!Array.isArray(p.entries) || !p.entries.length || p.entries.length > PACK_LIMIT) throw new Error("A pack needs 1–48 sounds.");
  const entries = p.entries.map(parseEntry);
  const ids = new Set<string>(); const blind = new Set<string>();
  for (const e of entries) {
    if (!e.id.startsWith(`${p.namespace}:`)) throw new Error("Preset ID does not match pack namespace.");
    if (ids.has(e.id) || blind.has(auditionId(e.id))) throw new Error("Duplicate preset or audition ID.");
    ids.add(e.id); blind.add(auditionId(e.id));
  }
  return { format: "phosphor-preset-pack", version: 1, namespace: p.namespace, entries };
}

export function matchesPreset(entry: PresetEntry, role: Role | "all", query: string, blind = false): boolean {
  const m = entry.metadata;
  if (role !== "all" && !m.roles.includes(role)) return false;
  const words = [...m.roles, ...m.tags, ...Object.values(m.character), m.playing,
    m.character.motion === "still" ? "static" : "moving motion", m.character.body === "full/warm" ? "warm full body" : "",
    ...(blind ? [auditionId(entry.id)] : [m.name, entry.id, m.contributor, m.tryThis])].join(" ").toLowerCase();
  return query.toLowerCase().trim().split(/\s+/).every(term => words.includes(term));
}

export function defaultMetadata(name: string): PresetMetadata {
  return {
    name, contributor: "Local author", provenance: "Saved from the instrument; character tags are author intent, not measurements.",
    roles: ["wildcard"], tags: [],
    character: { brightness: "balanced", body: "rounded", attack: "rounded", texture: "smooth", motion: "still", space: "dry/close", width: "mono" },
    range: [48, 72], playing: "both", release: "Release follows the sound's release setting.",
    tryThis: "Play in the suggested register, then try a held note.", recommendedBpm: null,
    validation: "authored-unheard", measurements: [], listeningNotes: [],
  };
}
