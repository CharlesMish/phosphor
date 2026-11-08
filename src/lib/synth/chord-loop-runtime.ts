import { synth } from "./engine";
import { noteLooper, onPanic, performanceInput } from "./looper-runtime";
import { beatDurationSeconds } from "./motion";
import { LOOP_LOOKAHEAD, LOOP_TICK_MS } from "./note-looper";
import { useSynthStore } from "./store";
import {
  CHORD_LENGTHS,
  MAX_CHORDS,
  canTranspose,
  chordAtBeat,
  chordName,
  emptyChordLoop,
  fitsTranspose,
  loopBeats,
  midiOK,
  noteName,
  normalizeChord,
  parseChordLoop,
  sounding,
  type ChordLength,
  type ChordLoopDocument,
  type ExportEnding,
  type ExportTimes,
  type LoopChord,
} from "./chord-loop";

export const CHORD_LOOP_STORAGE_KEY = "phosphor.chordLoop.v1";
/** Scheduled-run IDs for this transport, kept clear of the note looper's small integers. */
const RUN_BASE = 1_000_000;

export type ChordLoopSnapshot = {
  doc: ChordLoopDocument;
  playing: boolean;
  /** Chord sounding now (playing) or -1. */
  chordIndex: number;
  progress: number;
  /** Notes held right now on any input, sorted. */
  held: number[];
  /** The fullest chord of the last gesture (keys down → all keys up). */
  lastChord: number[];
  /** Changes made while playing apply from the next pass. */
  pending: boolean;
  message: string;
};

type Pass = { index: number; start: number; end: number; beat: number; chords: LoopChord[]; transpose: number; scheduled: Set<string> };

function storage(): Pick<Storage, "getItem" | "setItem"> | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** Keys → chord list → looped playback on the shared scheduled-note transport. */
export class ChordLoopController {
  private snapshot: ChordLoopSnapshot;
  private listeners = new Set<() => void>();
  private held = new Set<number>();
  private gesture: number[] = [];
  private run = RUN_BASE;
  private timer: number | null = null;
  private passes: Pass[] = [];
  private auditionTimer: number | null = null;

  constructor() {
    let doc = emptyChordLoop();
    try {
      const raw = storage()?.getItem(CHORD_LOOP_STORAGE_KEY);
      if (raw) doc = parseChordLoop(JSON.parse(raw));
    } catch { /* start empty */ }
    this.snapshot = { doc, playing: false, chordIndex: -1, progress: 0, held: [], lastChord: [], pending: false, message: "" };
    performanceInput.subscribe((event) => {
      if (event.type === "on") {
        this.held.add(event.midi);
        const now = [...this.held].sort((a, b) => a - b);
        if (now.length >= this.gesture.length) this.gesture = now;
      } else {
        this.held.delete(event.midi);
        if (this.held.size === 0 && this.gesture.length) {
          this.update({ lastChord: this.gesture, held: [] });
          this.gesture = [];
          return;
        }
      }
      this.update({ held: [...this.held].sort((a, b) => a - b) });
    });
    performanceInput.onReset(() => { this.held.clear(); this.gesture = []; this.update({ held: [] }); });
    onPanic(() => this.stop());
    // The note looper and phrase renders take the transport; the chord loop yields.
    noteLooper.subscribe(() => {
      const state = noteLooper.getSnapshot().state;
      if (this.snapshot.playing && (state === "recording" || state === "playing")) this.halt("The note loop took over playback.");
    });
  }

  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private update(patch: Partial<ChordLoopSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  private commit(doc: ChordLoopDocument, message = "") {
    try { storage()?.setItem(CHORD_LOOP_STORAGE_KEY, JSON.stringify(doc)); } catch { /* kept for this visit */ }
    const pending = this.snapshot.playing;
    this.update({ doc, message, pending: pending || this.snapshot.pending });
    if (this.snapshot.playing && !doc.chords.length) this.stop();
  }

  private say(message: string) { this.update({ message }); }

  // ---- editing --------------------------------------------------------

  /** The chord to add: what is held now, else the fullest chord of the last gesture. */
  capturedChord(): number[] {
    return this.held.size ? [...this.held].sort((a, b) => a - b) : this.snapshot.lastChord;
  }

  addCapturedChord() {
    const played = normalizeChord(this.capturedChord());
    if (!played.length) { this.say("Play a chord first, then add it (Enter, or Add chord)."); return; }
    this.addChord(played);
  }

  /** Adds notes as they sound: with the loop transposed, the stored shape is shifted back. */
  addChord(played: readonly number[]) {
    const { doc } = this.snapshot;
    if (doc.chords.length >= MAX_CHORDS) { this.say(`The loop holds ${MAX_CHORDS} chords.`); return; }
    const shape = normalizeChord(played).map((n) => n - doc.transpose);
    if (!shape.length || !shape.every(midiOK)) { this.say("Reset transpose to add notes at this range."); return; }
    const chord: LoopChord = { notes: shape, beats: doc.newBeats };
    this.commit({ ...doc, chords: [...doc.chords, chord] },
      `Added ${chordName(shape, doc.transpose)} (${sounding(shape, doc.transpose).map(noteName).join(" ")}). Play the next chord and add it.`);
  }

  removeChord(index: number) {
    const { doc } = this.snapshot;
    if (!doc.chords[index]) return;
    this.commit({ ...doc, chords: doc.chords.filter((_, i) => i !== index) }, `Removed chord ${index + 1}.`);
  }

  moveEarlier(index: number) {
    const { doc } = this.snapshot;
    if (index < 1 || !doc.chords[index]) return;
    const chords = doc.chords.slice();
    [chords[index - 1], chords[index]] = [chords[index]!, chords[index - 1]!];
    this.commit({ ...doc, chords });
  }

  setChordBeats(index: number, beats: ChordLength) {
    const { doc } = this.snapshot;
    if (!doc.chords[index] || !(CHORD_LENGTHS as readonly number[]).includes(beats)) return;
    this.commit({ ...doc, chords: doc.chords.map((c, i) => i === index ? { ...c, beats } : c) });
  }

  setAllBeats(beats: ChordLength) {
    const { doc } = this.snapshot;
    if (!(CHORD_LENGTHS as readonly number[]).includes(beats)) return;
    this.commit({ ...doc, newBeats: beats, chords: doc.chords.map((c) => ({ ...c, beats })) },
      doc.chords.length ? `Every chord now lasts ${beats} beat${beats > 1 ? "s" : ""}.` : "");
  }

  setNewBeats(beats: ChordLength) {
    if (!(CHORD_LENGTHS as readonly number[]).includes(beats)) return;
    this.commit({ ...this.snapshot.doc, newBeats: beats });
  }

  /** `notes` are stored (untransposed) pitches, as the voicing editor works on them. */
  replaceChord(index: number, notes: readonly number[]) {
    const { doc } = this.snapshot;
    const shape = normalizeChord(notes);
    if (!doc.chords[index] || !shape.length || !fitsTranspose(shape, doc.transpose)) return;
    this.commit({ ...doc, chords: doc.chords.map((c, i) => i === index ? { ...c, notes: shape } : c) },
      `Updated chord ${index + 1}: ${sounding(shape, doc.transpose).map(noteName).join(" ")}.`);
  }

  transposeTo(to: number) {
    const { doc } = this.snapshot;
    if (!canTranspose(doc.chords, to)) return;
    this.commit({ ...doc, transpose: to });
  }

  clear() {
    this.stop();
    this.commit({ ...this.snapshot.doc, chords: [], transpose: 0 }, "Chord loop cleared.");
  }

  setExport(times: ExportTimes, ending: ExportEnding) {
    this.commit({ ...this.snapshot.doc, exportTimes: times, ending });
  }

  // ---- transport ------------------------------------------------------

  play() {
    const { doc } = this.snapshot;
    if (!doc.chords.length) { this.say("Add a chord first."); return; }
    if (noteLooper.getSnapshot().state === "recording") { this.say("Finish recording first. Your take is untouched."); return; }
    if (!synth.unlock()) return;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.stopAudition();
    noteLooper.stop();
    const ctx = synth.getContext();
    if (!ctx) return;
    this.run += 1;
    synth.beginScheduledRun(this.run);
    const start = ctx.currentTime + 0.05;
    this.passes = [this.makePass(0, start)];
    this.update({ playing: true, pending: false, chordIndex: 0, progress: 0, message: "" });
    const run = this.run;
    this.timer = window.setInterval(() => this.tick(run), LOOP_TICK_MS);
    this.tick(run);
  }

  /** Stop playback and silence the loop's notes. */
  stop() {
    const owned = synth.scheduledRunId() === this.run;
    this.halt("");
    this.stopAudition();
    if (owned) synth.cancelScheduledNotes();
  }

  /** Stop the timer without touching notes another transport may now own. */
  private halt(message: string) {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.passes = [];
    if (this.snapshot.playing || message) this.update({ playing: false, chordIndex: -1, progress: 0, pending: false, message: message || this.snapshot.message });
  }

  private makePass(index: number, start: number): Pass {
    const { doc } = this.snapshot;
    const beat = beatDurationSeconds(useSynthStore.getState().motionBpm);
    const chords = doc.chords.map((c) => ({ ...c, notes: c.notes.slice() }));
    return { index, start, end: start + loopBeats(chords) * beat, beat, chords, transpose: doc.transpose, scheduled: new Set() };
  }

  private tick(run: number) {
    if (run !== this.run || !this.snapshot.playing) return;
    // Something else (a sound change, the note looper, a render) took the transport.
    if (synth.scheduledRunId() !== run) { this.halt("Chord loop stopped: another part of the instrument took playback."); return; }
    const ctx = synth.getContext();
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    let last = this.passes[this.passes.length - 1];
    while (last && last.end <= now + LOOP_LOOKAHEAD) {
      if (!this.snapshot.doc.chords.length) { this.stop(); return; }
      last = this.makePass(last.index + 1, last.end);
      this.passes.push(last);
      if (this.snapshot.pending) this.update({ pending: false });
    }
    for (const pass of this.passes) {
      let at = pass.start;
      pass.chords.forEach((chord, index) => {
        const end = at + chord.beats * pass.beat;
        if (at <= now + LOOP_LOOKAHEAD && end > now) {
          for (const midi of sounding(chord.notes, pass.transpose)) {
            const id = `${run}:${pass.index}:${index}:${midi}`;
            if (pass.scheduled.has(id) || !midiOK(midi)) continue;
            // Long main-thread stalls skip missed attacks rather than bursting old notes.
            if (at < now - LOOP_TICK_MS / 1000) continue;
            synth.scheduleNote(run, id, midi, at, end);
            pass.scheduled.add(id);
          }
        }
        at = end;
      });
    }
    // Forget passes (and their note IDs) once every note has been released.
    this.passes = this.passes.filter((p) => p.end > now - 5);
    synth.refreshScheduledVoices();
    const current = this.passes.find((p) => p.start <= now && now < p.end) ?? this.passes[0];
    if (current) {
      const beat = (now - current.start) / current.beat;
      const total = loopBeats(current.chords);
      this.update({
        chordIndex: now < current.start ? 0 : chordAtBeat(current.chords, beat),
        progress: total ? Math.max(0, Math.min(1, beat / total)) : 0,
      });
    }
  }

  /** Hear a voicing (stored pitches) for one second at the loop's transpose. */
  audition(notes: readonly number[]) {
    if (this.snapshot.playing) return;
    const loop = noteLooper.getSnapshot().state;
    if (loop === "recording") { this.say("Finish recording first. Your take is untouched."); return; }
    if (loop === "playing") { this.say("Stop the note loop to audition a voicing."); return; }
    if (!synth.unlock()) return;
    const ctx = synth.getContext();
    if (!ctx) return;
    this.stopAudition();
    this.run += 1;
    synth.beginScheduledRun(this.run);
    const at = ctx.currentTime + 0.03;
    sounding(notes, this.snapshot.doc.transpose).filter(midiOK).forEach((midi, i) => synth.scheduleNote(this.run, `audition:${i}`, midi, at, at + 1));
    const run = this.run;
    this.auditionTimer = window.setTimeout(() => { if (synth.scheduledRunId() === run) synth.refreshScheduledVoices(); this.auditionTimer = null; }, 1600);
  }

  private stopAudition() {
    if (this.auditionTimer !== null) window.clearTimeout(this.auditionTimer);
    this.auditionTimer = null;
  }
}

export const chordLoop = new ChordLoopController();
