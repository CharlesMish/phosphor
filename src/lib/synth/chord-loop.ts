import { beatDurationSeconds, clampMotionBpm } from "./motion";

/**
 * Chord loop: a list of held chords, each with its own length, played in order
 * and looped. Modelled on Quire's backing loop and Lost Registers'
 * progression: chords are captured from the keys, re-voiced note by note, and
 * transposed as a whole without touching the stored voicings.
 */

/** Chord lengths in beats (4/4): 1 beat … 8 bars. */
export const CHORD_LENGTHS = [1, 2, 4, 8, 16, 32] as const;
export type ChordLength = (typeof CHORD_LENGTHS)[number];
export const MAX_CHORDS = 32;
/** Leaves room for live playing over the loop inside the engine's 12 voices. */
export const MAX_CHORD_NOTES = 8;
export const MAX_TRANSPOSE = 12;
export const EXPORT_TIMES = [1, 2, 4, 8] as const;
export type ExportTimes = (typeof EXPORT_TIMES)[number];
export type ExportEnding = "loop" | "take";
/** Longest exported file. A 5-minute 48 kHz float stereo WAV is about 110 MB. */
export const MAX_EXPORT_SECONDS = 300;

export type LoopChord = { notes: number[]; beats: ChordLength };
export type ChordLoopDocument = {
  format: "phosphor-chord-loop";
  version: 1;
  chords: LoopChord[];
  transpose: number;
  newBeats: ChordLength;
  exportTimes: ExportTimes;
  ending: ExportEnding;
};

export function emptyChordLoop(): ChordLoopDocument {
  return { format: "phosphor-chord-loop", version: 1, chords: [], transpose: 0, newBeats: 4, exportTimes: 2, ending: "loop" };
}

export function lengthLabel(beats: ChordLength): string {
  if (beats < 4) return beats === 1 ? "1 beat" : `${beats} beats`;
  const bars = beats / 4;
  return bars === 1 ? "1 bar" : `${bars} bars`;
}

export const midiOK = (n: number) => Number.isInteger(n) && n >= 0 && n <= 127;

/** Sorted, de-duplicated, at most MAX_CHORD_NOTES (lowest kept). */
export function normalizeChord(notes: readonly number[]): number[] {
  return [...new Set(notes)].filter(midiOK).sort((a, b) => a - b).slice(0, MAX_CHORD_NOTES);
}

export function fitsTranspose(notes: readonly number[], semitones: number): boolean {
  return notes.every((n) => midiOK(n + semitones));
}

export function canTranspose(chords: readonly LoopChord[], to: number): boolean {
  return Number.isInteger(to) && Math.abs(to) <= MAX_TRANSPOSE && chords.every((c) => fitsTranspose(c.notes, to));
}

export function sounding(notes: readonly number[], transpose: number): number[] {
  return notes.map((n) => n + transpose);
}

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const QUALITIES: [number[], string][] = [
  [[0, 4, 7], ""],
  [[0, 3, 7], "m"],
  [[0, 3, 6], "dim"],
  [[0, 4, 8], "aug"],
  [[0, 5, 7], "sus4"],
  [[0, 2, 7], "sus2"],
  [[0, 4, 7, 10], "7"],
  [[0, 4, 7, 11], "maj7"],
  [[0, 3, 7, 10], "m7"],
  [[0, 3, 7, 11], "m(maj7)"],
  [[0, 3, 6, 10], "m7b5"],
  [[0, 3, 6, 9], "dim7"],
  [[0, 5, 7, 10], "7sus4"],
  [[0, 4, 7, 9], "6"],
  [[0, 3, 7, 9], "m6"],
  [[0, 2, 4, 7], "add9"],
  [[0, 2, 3, 7], "m(add9)"],
  [[0, 2, 4, 7, 10], "9"],
  [[0, 2, 4, 7, 11], "maj9"],
  [[0, 2, 3, 7, 10], "m9"],
  [[0, 2, 4, 7, 9], "6/9"],
  [[0, 7], "5"],
];

export function pitchName(midi: number): string {
  return NAMES[((midi % 12) + 12) % 12]!;
}

export function noteName(midi: number): string {
  return `${pitchName(midi)}${Math.floor(midi / 12) - 1}`;
}

/** A short name for a chord: "Am", "Fmaj7", "G/B", or its pitch names if unnamed. */
export function chordName(notes: readonly number[], transpose = 0): string {
  const sorted = [...new Set(notes)].map((n) => n + transpose).sort((a, b) => a - b);
  if (!sorted.length) return "";
  const pcs = [...new Set(sorted.map((m) => ((m % 12) + 12) % 12))];
  const bass = ((sorted[0]! % 12) + 12) % 12;
  if (pcs.length === 1) return NAMES[bass]!;
  for (const root of [bass, ...pcs.filter((p) => p !== bass)]) {
    const rel = pcs.map((p) => (p - root + 12) % 12).sort((a, b) => a - b);
    for (const [shape, quality] of QUALITIES) {
      const want = [...shape].sort((a, b) => a - b);
      if (want.length === rel.length && want.every((x, i) => x === rel[i])) {
        return NAMES[root] + quality + (root === bass ? "" : `/${NAMES[bass]}`);
      }
    }
  }
  return sorted.map(pitchName).join(" ");
}

export function loopBeats(chords: readonly LoopChord[]): number {
  return chords.reduce((sum, chord) => sum + chord.beats, 0);
}

export function loopSeconds(chords: readonly LoopChord[], bpm: number): number {
  return loopBeats(chords) * beatDurationSeconds(clampMotionBpm(bpm));
}

/** One note of the loop in beats from the start of pass 0. */
export type LoopNote = { midi: number; startBeat: number; endBeat: number; chord: number; pass: number };

/** Notes for passes [firstPass, lastPass] at the given transpose. Each chord is struck on its first beat and held to its last. */
export function loopNotes(chords: readonly LoopChord[], transpose: number, firstPass: number, lastPass: number): LoopNote[] {
  const total = loopBeats(chords);
  const out: LoopNote[] = [];
  for (let pass = firstPass; pass <= lastPass; pass++) {
    let at = pass * total;
    chords.forEach((chord, index) => {
      for (const midi of sounding(chord.notes, transpose)) {
        if (midiOK(midi)) out.push({ midi, startBeat: at, endBeat: at + chord.beats, chord: index, pass });
      }
      at += chord.beats;
    });
  }
  return out;
}

/** Which chord sounds at a beat inside one pass. */
export function chordAtBeat(chords: readonly LoopChord[], beat: number): number {
  let at = 0;
  for (let i = 0; i < chords.length; i++) {
    at += chords[i]!.beats;
    if (beat < at) return i;
  }
  return Math.max(0, chords.length - 1);
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

export type MotionLoopTiming = { mode: "one-shot" | "loop" | "ping-pong"; beats: number; active: boolean };

export type ExportPlan = {
  times: number;
  loopSeconds: number;
  /** Seconds of audio in the file, before any tail. */
  bodySeconds: number;
  note: string;
  ok: boolean;
};

/**
 * How many times through to export. A seamless file must also hold whole
 * Motion cycles, so a looping Motion can round the count up (as in Quire).
 */
export function planChordExport(chords: readonly LoopChord[], bpm: number, times: number, ending: ExportEnding, motion: MotionLoopTiming, tailSeconds = 0): ExportPlan {
  const beats = loopBeats(chords);
  const cycle = loopSeconds(chords, bpm);
  let count = Math.max(1, Math.round(times));
  let note = "";
  if (!beats) return { times: count, loopSeconds: 0, bodySeconds: 0, note: "Add a chord first.", ok: false };
  const periodic = motion.active && motion.mode !== "one-shot";
  if (ending === "loop" && periodic) {
    const every = motion.beats / gcd(beats, motion.beats);
    if (count % every) {
      count = Math.ceil(count / every) * every;
      note = `Motion repeats every ${motion.beats} beats, so it takes ${count} times through to loop cleanly.`;
    }
  }
  const extra = ending === "take" ? tailSeconds : 0;
  if (cycle + extra > MAX_EXPORT_SECONDS) {
    return { times: 1, loopSeconds: cycle, bodySeconds: cycle, ok: false,
      note: `One pass is ${Math.round(cycle)} s, over the ${MAX_EXPORT_SECONDS / 60}-minute export limit. Shorten chords or raise the tempo.` };
  }
  if (count * cycle + extra > MAX_EXPORT_SECONDS) {
    const step = ending === "loop" && periodic ? motion.beats / gcd(beats, motion.beats) : 1;
    const fits = Math.floor((MAX_EXPORT_SECONDS - extra) / (cycle * step)) * step;
    if (fits >= 1) {
      count = fits;
      note = `${count} times through: the most that fits in the ${MAX_EXPORT_SECONDS / 60}-minute limit${step > 1 ? " and still loops Motion cleanly" : ""}.`;
    } else {
      count = Math.max(1, Math.floor((MAX_EXPORT_SECONDS - extra) / cycle));
      note = `A clean Motion loop needs ${step} times through, over the limit; this file is ${count}× and Motion won't line up at the seam.`;
    }
  }
  if (ending === "loop" && motion.active && motion.mode === "one-shot") {
    note = note || "One-shot Motion restarts at the top of the file, so it jumps at the loop seam.";
  }
  return { times: count, loopSeconds: cycle, bodySeconds: count * cycle, note, ok: true };
}

/** Filenames in the style of Quire's exports: "C/G" → "ConG", "F#" → "Fs". */
export function exportFileName(chords: readonly LoopChord[], transpose: number, bpm: number, times: number, ending: ExportEnding): string {
  const names = chords.slice(0, 6).map((c) => chordName(c.notes, transpose)
    .replace(/\//g, "on").replace(/#/g, "s").replace(/[^A-Za-z0-9]/g, ""));
  const more = chords.length > 6 ? "-etc" : "";
  return `phosphor-${ending}-${names.join("_")}${more}-${Math.round(bpm)}bpm${times > 1 ? `-x${times}` : ""}.wav`;
}

const isLength = (v: unknown): v is ChordLength => (CHORD_LENGTHS as readonly unknown[]).includes(v);

/** Validates stored or imported chord loops; never throws. Invalid parts fall back to defaults. */
export function parseChordLoop(input: unknown): ChordLoopDocument {
  const out = emptyChordLoop();
  if (!input || typeof input !== "object") return out;
  const v = input as Record<string, unknown>;
  if (Array.isArray(v.chords)) {
    for (const raw of v.chords.slice(0, MAX_CHORDS)) {
      if (!raw || typeof raw !== "object") continue;
      const c = raw as Record<string, unknown>;
      if (!Array.isArray(c.notes)) continue;
      const notes = normalizeChord(c.notes.filter((n): n is number => typeof n === "number"));
      if (!notes.length) continue;
      out.chords.push({ notes, beats: isLength(c.beats) ? c.beats : 4 });
    }
  }
  if (typeof v.transpose === "number" && canTranspose(out.chords, v.transpose)) out.transpose = v.transpose;
  if (isLength(v.newBeats)) out.newBeats = v.newBeats;
  if ((EXPORT_TIMES as readonly unknown[]).includes(v.exportTimes)) out.exportTimes = v.exportTimes as ExportTimes;
  if (v.ending === "loop" || v.ending === "take") out.ending = v.ending;
  return out;
}

/** Beats → seconds at a tempo. */
export function beatsToSeconds(beats: number, bpm: number): number {
  return beats * beatDurationSeconds(clampMotionBpm(bpm));
}
