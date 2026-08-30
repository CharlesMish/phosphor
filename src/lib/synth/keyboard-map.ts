/** Lower C of the visible keyboard at octave offset 0. C3 = 48. */
export const BASE_MIDI = 48;
export const VISIBLE_SEMITONES = 24;

/**
 * QWERTY row → one octave of semitones from the current base,
 * then the next keys continue into the second octave.
 * A W S E D F T G Y H U J K O L P ; '
 */
export const KEY_TO_OFFSET: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
  Quote: 17,
};

export const OFFSET_TO_HINT: Record<number, string> = {
  0: "A",
  1: "W",
  2: "S",
  3: "E",
  4: "D",
  5: "F",
  6: "T",
  7: "G",
  8: "Y",
  9: "H",
  10: "U",
  11: "J",
  12: "K",
  13: "O",
  14: "L",
  15: "P",
  16: ";",
  17: "'",
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function midiName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[pc] ?? "C"}${oct}`;
}

export function isBlackKey(midi: number): boolean {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export function rangeLabel(octaveOffset: number): string {
  const start = BASE_MIDI + octaveOffset * 12;
  const end = start + VISIBLE_SEMITONES;
  return `${midiName(start)}–${midiName(end)}`;
}

export function midiFromCode(code: string, octaveOffset: number): number | null {
  const offset = KEY_TO_OFFSET[code];
  if (offset === undefined) return null;
  return BASE_MIDI + octaveOffset * 12 + offset;
}
