import assert from "node:assert/strict";
import { it } from "node:test";
import {
  KEY_LAYOUTS,
  legends,
  midiFromCode,
  octaveStep,
  rangeLabel,
} from "./keyboard-map.ts";
import {
  CHORD_LENGTHS,
  MAX_CHORDS,
  MAX_CHORD_NOTES,
  MAX_EXPORT_SECONDS,
  canTranspose,
  chordAtBeat,
  chordName,
  exportFileName,
  lengthLabel,
  loopBeats,
  loopNotes,
  normalizeChord,
  parseChordLoop,
  planChordExport,
  type LoopChord,
} from "./chord-loop.ts";
import { chordLoopNotes, loopLeadSeconds } from "./chord-loop-render.ts";
import { motionElapsed, phraseTailSeconds } from "./phrase-render.ts";
import { createFactorySession } from "./session-apply.ts";
import { parseSessionDocument, serializeSession, type SessionDocument } from "./session-file.ts";
import { PerformanceInput } from "./performance.ts";
import { NoteLooper, type LoopPort } from "./note-looper.ts";

const off = { mode: "loop" as const, beats: 4, active: false };

function session(edit: (document: SessionDocument) => void = () => {}): SessionDocument {
  const document = parseSessionDocument(JSON.parse(serializeSession(createFactorySession())));
  edit(document);
  return parseSessionDocument(document);
}

it("two-row keys play Gmaj7 over G as B M W 5, by physical key", () => {
  const notes = ["KeyB", "KeyM", "KeyW", "Digit5"].map((code) => midiFromCode(code, 0, "tracker"));
  assert.deepEqual(notes, [55, 59, 62, 66]);
  assert.equal(midiFromCode("KeyZ", 0, "tracker"), 48);
  assert.equal(midiFromCode("KeyQ", 0, "tracker"), 60);
  assert.equal(midiFromCode("Comma", 0, "tracker"), 60);
  assert.equal(midiFromCode("KeyP", 1, "tracker"), 88);
  assert.equal(midiFromCode("KeyA", 0, "tracker"), null);
  assert.equal(midiFromCode("Digit1", 0, "tracker"), null);
  assert.equal(midiFromCode("Digit4", 0, "tracker"), null);
});

it("one-row keys keep Phosphor's original layout", () => {
  assert.equal(midiFromCode("KeyA", 0, "row"), 48);
  assert.equal(midiFromCode("KeyW", 0, "row"), 49);
  assert.equal(midiFromCode("Quote", 0, "row"), 65);
  assert.equal(midiFromCode("KeyZ", 0, "row"), null);
  assert.equal(midiFromCode("KeyA", 0), 48, "default argument stays one row for older callers");
});

it("legends print the top row on the upper octave and the span covers both rows", () => {
  const tracker = legends("tracker");
  assert.equal(tracker.get(0), "Z");
  assert.equal(tracker.get(1), "S");
  assert.equal(tracker.get(12), "Q");
  assert.equal(tracker.get(13), "2");
  assert.equal(tracker.get(28), "P");
  assert.equal(KEY_LAYOUTS.tracker.span, 28);
  assert.equal(rangeLabel(0, "tracker"), "C3–E5");
  assert.equal(rangeLabel(0, "row"), "C3–C5");
  assert.equal(legends("row").get(0), "A");
  assert.equal(legends("row").get(17), "'");
});

it("− and = change octave in both layouts", () => {
  assert.equal(octaveStep("Minus"), -1);
  assert.equal(octaveStep("Equal"), 1);
  assert.equal(octaveStep("NumpadAdd"), 1);
  assert.equal(octaveStep("KeyZ"), 0);
});

it("names chords like Quire, including slash chords and extensions", () => {
  assert.equal(chordName([55, 59, 62, 66]), "Gmaj7");
  assert.equal(chordName([59, 62, 67]), "G/B");
  assert.equal(chordName([54, 58, 61, 65]), "F#maj7");
  assert.equal(chordName([53, 56, 60, 63]), "Fm7");
  assert.equal(chordName([48, 52, 55, 62]), "Cadd9");
  assert.equal(chordName([48, 52, 55, 59, 62]), "Cmaj9");
  assert.equal(chordName([48, 52, 55], 2), "D");
  assert.equal(chordName([60]), "C");
  assert.equal(chordName([60, 61, 62]), "C C# D");
});

it("normalizes chords and limits notes", () => {
  assert.deepEqual(normalizeChord([64, 60, 64, 67]), [60, 64, 67]);
  assert.equal(normalizeChord([40, 41, 42, 43, 44, 45, 46, 47, 48, 49]).length, MAX_CHORD_NOTES);
  assert.deepEqual(normalizeChord([-1, 128, 60.5, 61]), [61]);
});

it("lays chords out in beats across passes", () => {
  const chords: LoopChord[] = [{ notes: [48, 52, 55], beats: 4 }, { notes: [53, 57], beats: 8 }];
  assert.equal(loopBeats(chords), 12);
  const notes = loopNotes(chords, 2, 0, 1);
  assert.equal(notes.length, 10);
  assert.deepEqual(notes[0], { midi: 50, startBeat: 0, endBeat: 4, chord: 0, pass: 0 });
  assert.deepEqual(notes.at(-1), { midi: 59, startBeat: 16, endBeat: 24, chord: 1, pass: 1 });
  assert.equal(chordAtBeat(chords, 3.99), 0);
  assert.equal(chordAtBeat(chords, 4), 1);
  assert.equal(lengthLabel(1), "1 beat");
  assert.equal(lengthLabel(16), "4 bars");
  assert.deepEqual([...CHORD_LENGTHS], [1, 2, 4, 8, 16, 32]);
});

it("transposes the whole loop only while every note stays in MIDI range", () => {
  const chords: LoopChord[] = [{ notes: [118, 122], beats: 4 }];
  assert.equal(canTranspose(chords, 5), true);
  assert.equal(canTranspose(chords, 6), false);
  assert.equal(canTranspose(chords, -12), true);
  assert.equal(canTranspose(chords, -13), false, "±12 semitones at most");
});

it("rounds exports up to whole Motion cycles for seamless loops, like Quire", () => {
  const chords: LoopChord[] = [{ notes: [48], beats: 4 }, { notes: [50], beats: 4 }, { notes: [52], beats: 4 }];
  const plain = planChordExport(chords, 120, 1, "loop", off);
  assert.equal(plain.times, 1);
  assert.equal(plain.loopSeconds, 6);
  const moving = planChordExport(chords, 120, 1, "loop", { mode: "loop", beats: 8, active: true });
  assert.equal(moving.times, 2);
  assert.match(moving.note, /2 times through/);
  const take = planChordExport(chords, 120, 1, "take", { mode: "loop", beats: 8, active: true });
  assert.equal(take.times, 1, "a take does not need to loop");
  const oneShot = planChordExport(chords, 120, 1, "loop", { mode: "one-shot", beats: 8, active: true });
  assert.match(oneShot.note, /jumps at the loop seam/);
});

it("caps exports at five minutes and refuses a single pass that is longer", () => {
  const long: LoopChord[] = Array.from({ length: 4 }, () => ({ notes: [48], beats: 32 as const }));
  const plan = planChordExport(long, 60, 8, "loop", off);
  assert.equal(plan.ok, true);
  assert.ok(plan.times * plan.loopSeconds <= MAX_EXPORT_SECONDS);
  assert.equal(plan.times, 2);
  const huge: LoopChord[] = Array.from({ length: MAX_CHORDS }, () => ({ notes: [48], beats: 32 as const }));
  assert.equal(planChordExport(huge, 40, 1, "loop", off).ok, false);
});

it("names files like the other instruments' exports", () => {
  const chords: LoopChord[] = [
    { notes: [54, 58, 61, 65], beats: 4 },
    { notes: [53, 56, 60, 63], beats: 4 },
    { notes: [59, 62, 67], beats: 4 },
  ];
  assert.equal(exportFileName(chords, 0, 123, 1, "loop"), "phosphor-loop-Fsmaj7_Fm7_GonB-123bpm.wav");
  assert.equal(exportFileName(chords, 0, 123, 4, "take"), "phosphor-take-Fsmaj7_Fm7_GonB-123bpm-x4.wav");
  const many = Array.from({ length: 7 }, () => chords[0]!);
  assert.match(exportFileName(many, 0, 100, 1, "loop"), /-etc-100bpm\.wav$/);
});

it("reads a stored chord loop defensively", () => {
  const doc = parseChordLoop({ chords: [{ notes: [60, 64, 67], beats: 8 }, { notes: [], beats: 4 }, { notes: [62], beats: 3 }, "x"], transpose: 30, newBeats: 16, exportTimes: 4, ending: "take" });
  assert.deepEqual(doc.chords, [{ notes: [60, 64, 67], beats: 8 }, { notes: [62], beats: 4 }]);
  assert.equal(doc.transpose, 0);
  assert.equal(doc.newBeats, 16);
  assert.equal(doc.exportTimes, 4);
  assert.equal(doc.ending, "take");
  assert.deepEqual(parseChordLoop("nonsense").chords, []);
});

it("a seamless loop render starts inside the previous pass, so the file opens with its tails", () => {
  const document = session((value) => {
    value.motion.bpm = 120;
    value.motion.mode = "loop";
    value.envelope.attack = 0.01;
    value.envelope.release = 0.5;
    value.space.mix = 0.3;
    value.space.seconds = 2;
  });
  const chords: LoopChord[] = [{ notes: [48], beats: 2 }, { notes: [55], beats: 2 }];
  assert.ok(Math.abs(loopLeadSeconds(document) - (phraseTailSeconds(document) + 0.1)) < 1e-9);
  // Tail ≈ 2.55 s, so the G of the pass before last (starting 3 s before the file) still rings into it.
  const lead = loopLeadSeconds(document, chords);
  assert.ok(Math.abs(lead - 3.05) < 1e-9, String(lead));
  const notes = chordLoopNotes(document, { chords, transpose: 0, times: 1, ending: "loop" }, 1, lead);
  // One pass is 2 s; every note that is still audible at the top of the file starts inside the render.
  assert.ok(notes.every((n) => n.start >= 0 && n.end > n.start));
  assert.ok(notes.filter((n) => n.end + phraseTailSeconds(document) > lead).every((n) => n.start > 0), "no audible note is started late");
  const inFile = notes.filter((n) => n.start >= lead - 1e-9);
  // Pass 0, plus the next pass's downbeat queued at the file's end (2 s).
  assert.deepEqual(inFile.map((n) => [n.midi, +(n.start - lead).toFixed(6)]), [[48, 0], [55, 1], [48, 2], [55, 3]]);
  assert.ok(notes.some((n) => n.midi === 55 && Math.abs(n.end - lead) < 1e-9), "the previous pass's last chord ends at the seam");
  // Motion's beat 1 is the file's first sample; before it, looping Motion runs in phase.
  assert.equal(motionElapsed(document, lead, lead), 0);
  const period = 60 / 120 * document.motion.beats;
  assert.ok(Math.abs(motionElapsed(document, 0, lead) - (((-lead % period) + period) % period)) < 1e-9);
});

it("Shift take moves a recorded take by semitones and back, within MIDI range", () => {
  let time = 10;
  const timers = new Set<() => void>();
  const input = new PerformanceInput({ unlock: () => true, now: () => time, noteOn: () => {}, noteOff: () => {}, limitNote: () => {} });
  const port: LoopPort = {
    unlock: () => true, now: () => time, running: () => true, beginRun: () => {}, schedule: () => {},
    cancel: () => {}, refresh: () => {}, interval: (fn) => { timers.add(fn); return fn; }, clearInterval: (fn) => { timers.delete(fn as () => void); },
  };
  const loop = new NoteLooper(port, input, 120);
  assert.equal(loop.canShift(1), false, "no take yet");
  loop.loadTake(1, [{ id: 0, type: "on", midi: 120, beat: 0 }, { id: 0, type: "off", midi: 120, beat: 1 }]);
  assert.equal(loop.shiftTake(7), true);
  assert.equal(loop.getSnapshot().shift, 7);
  assert.equal(loop.getEvents()[0]!.midi, 127);
  assert.equal(loop.canShift(1), false, "would leave MIDI range");
  assert.equal(loop.shiftTake(-7), true);
  assert.deepEqual(loop.getEvents().map((e) => e.midi), [120, 120]);
  loop.loadTake(16, [{ id: 0, type: "on", midi: 60, beat: 60 }]);
  assert.equal(loop.getSnapshot().bars, 16);
  assert.equal(loop.getSnapshot().shift, 0);
  time = 11;
});
