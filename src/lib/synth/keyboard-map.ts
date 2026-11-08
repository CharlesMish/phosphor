/** Lower C of the visible keyboard at octave offset 0. C3 = 48. */
export const BASE_MIDI = 48;
/** Visible span of the one-row layout (kept for callers that predate layouts). */
export const VISIBLE_SEMITONES = 24;

/**
 * Computer-keyboard layouts, matched by physical key (`KeyboardEvent.code`),
 * so the same shapes work on AZERTY and QWERTZ keyboards.
 *
 * - "tracker" (default): two octaves on two rows, as in Quire and Lost
 *   Registers. Z X C V B N M play the lower octave (sharps on S D G H J;
 *   , L . ; / carry on into the next octave). Q W E R T Y U I O P play the
 *   octave above (sharps on 2 3 5 6 7 9 0). Gmaj7 over G is B M W 5.
 * - "row": Phosphor's original single row. A S D F G H J K are the white
 *   keys and W E T Y U the sharps; O L P ; ' continue upward.
 *
 * In both layouts − and = (or numpad − and +) change octave.
 */
export type KeyLayoutId = "tracker" | "row";

export type KeyLayout = {
  id: KeyLayoutId;
  name: string;
  /** Physical key code → semitones above the visible keyboard's lowest C. */
  notes: Readonly<Record<string, number>>;
  /** Semitones above the lowest C that the on-screen keyboard shows. */
  span: number;
  /** One line of help for the page. */
  hint: string;
};

export const KEY_LAYOUTS: Readonly<Record<KeyLayoutId, KeyLayout>> = {
  tracker: {
    id: "tracker",
    name: "Two rows",
    notes: {
      // Lower octave on the bottom row, sharps on the row above it…
      KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6,
      KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
      // …carrying on into the next octave.
      Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
      // The octave above on the top row, sharps on the digits.
      KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18,
      KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
      KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
    },
    span: 28,
    hint: "Z–M and Q–P · digits and S D G H J are sharps · − = octave · Enter adds chord",
  },
  row: {
    id: "row",
    name: "One row",
    notes: {
      KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6,
      KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12,
      KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
    },
    span: VISIBLE_SEMITONES,
    hint: "A–K · W E T Y U are sharps · − = octave · Enter adds chord",
  },
};

export const DEFAULT_KEY_LAYOUT: KeyLayoutId = "tracker";
export const OCTAVE_DOWN_CODES: readonly string[] = ["Minus", "NumpadSubtract"];
export const OCTAVE_UP_CODES: readonly string[] = ["Equal", "NumpadAdd"];

export function isKeyLayoutId(value: unknown): value is KeyLayoutId {
  return value === "tracker" || value === "row";
}

const LABEL: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Semicolon: ";",
  Slash: "/",
  Quote: "'",
  Minus: "−",
  Equal: "=",
};

/** One-row hints, kept for older callers. */
export const KEY_TO_OFFSET: Readonly<Record<string, number>> = KEY_LAYOUTS.row.notes;
export const OFFSET_TO_HINT: Readonly<Record<number, string>> = Object.fromEntries(legends("row"));

export function keyLabel(code: string): string {
  return LABEL[code] ?? code.replace(/^Key/, "").replace(/^Digit/, "");
}

/**
 * The computer key printed on each on-screen key (semitones above the lowest
 * C): the first key that plays it, preferring the top row for the upper octave.
 */
export function legends(layoutId: KeyLayoutId): Map<number, string> {
  const layout = KEY_LAYOUTS[layoutId];
  const out = new Map<number, string>();
  const codes = Object.keys(layout.notes);
  const upper = (code: string) => /^Key[QWERTYUIOP]$|^Digit/.test(code);
  for (let semi = 0; semi <= layout.span; semi++) {
    const playing = codes.filter((code) => layout.notes[code] === semi);
    if (!playing.length) continue;
    const pick = layoutId === "tracker" && semi >= 12 ? (playing.find(upper) ?? playing[0]!) : playing[0]!;
    out.set(semi, keyLabel(pick));
  }
  return out;
}

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

export function rangeLabel(octaveOffset: number, layoutId: KeyLayoutId = "row"): string {
  const start = BASE_MIDI + octaveOffset * 12;
  const end = start + KEY_LAYOUTS[layoutId].span;
  return `${midiName(start)}–${midiName(end)}`;
}

export function midiFromCode(code: string, octaveOffset: number, layoutId: KeyLayoutId = "row"): number | null {
  const offset = KEY_LAYOUTS[layoutId].notes[code];
  if (offset === undefined) return null;
  const midi = BASE_MIDI + octaveOffset * 12 + offset;
  return midi >= 0 && midi <= 127 ? midi : null;
}

/** Octave step for a key code, or 0 when the key does not change octave. */
export function octaveStep(code: string): -1 | 0 | 1 {
  if (OCTAVE_DOWN_CODES.includes(code)) return -1;
  if (OCTAVE_UP_CODES.includes(code)) return 1;
  return 0;
}
