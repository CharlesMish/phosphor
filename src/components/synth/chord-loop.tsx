import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { chordLoop } from "@/lib/synth/chord-loop-runtime";
import {
  CHORD_LENGTHS,
  EXPORT_TIMES,
  MAX_CHORDS,
  canTranspose,
  chordName,
  exportFileName,
  fitsTranspose,
  lengthLabel,
  midiOK,
  noteName,
  sounding,
  type ChordLength,
  type ExportEnding,
  type ExportTimes,
} from "@/lib/synth/chord-loop";
import { chordLoopPlan, encodeChordLoopWav, renderChordLoop } from "@/lib/synth/chord-loop-render";
import { invalidatePhraseRenders, playPhraseRender, stopPhraseAudition } from "@/lib/synth/phrase-export";
import { captureSession } from "@/lib/synth/session-apply";
import { serializeSession } from "@/lib/synth/session-file";
import { noteLooper, onPanic } from "@/lib/synth/looper-runtime";
import { useSynthStore } from "@/lib/synth/store";
import { synth } from "@/lib/synth/engine";
import { cn } from "@/lib/utils";

const field = "h-9 rounded-md bg-surface-2 px-2 text-xs text-fg shadow-border outline-none focus-visible:ring-2 focus-visible:ring-focus/50";
const chip = "h-8 rounded px-2 font-mono text-xs transition-colors disabled:opacity-40";

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: "audio/wav" }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Quire / Lost Registers style chord loop: capture, re-voice, transpose, export. */
export function ChordLoopControls() {
  const snap = useSyncExternalStore(chordLoop.subscribe, chordLoop.getSnapshot);
  const bpm = useSynthStore((s) => s.motionBpm);
  // Everything the export plan depends on, so playback progress does not recapture the session.
  const planKey = useSynthStore((s) => JSON.stringify([s.motionBpm, s.motionMode, s.motionBeats, s.motionRoutes, Boolean(s.slotA && s.slotB), s.attack, s.release, s.spaceMix, s.spaceSeconds]));
  const { doc } = snap;
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (editing !== null && !doc.chords[editing]) setEditing(null);
  }, [doc.chords, editing]);
  useEffect(() => () => abortRef.current?.abort(), []);
  // Esc, window blur and hidden tabs discard a render in progress, as they do phrase renders.
  useEffect(() => onPanic(() => {
    const running = abortRef.current;
    if (!running || running.signal.aborted) return;
    running.abort(); setBusy(false); setStatus("Render discarded.");
  }), []);
  // Newer loop messages replace an older render status.
  useEffect(() => setStatus(""), [snap.message, doc]);

  const captured = snap.held.length ? snap.held : snap.lastChord;
  const full = doc.chords.length >= MAX_CHORDS;
  const plan = useMemo(() => doc.chords.length
    ? chordLoopPlan(captureSession(), { chords: doc.chords, transpose: doc.transpose, times: doc.exportTimes, ending: doc.ending })
    : null, [doc, planKey]);

  const render = (mode: "audition" | "export") => {
    if (!doc.chords.length || busy) return;
    if (noteLooper.getSnapshot().state === "recording") { setStatus("Finish recording first. Your take is untouched."); return; }
    abortRef.current?.abort();
    stopPhraseAudition();
    chordLoop.stop();
    noteLooper.stop();
    useSynthStore.getState().stopMotion();
    synth.allNotesOff();
    const session = captureSession();
    const request = { chords: doc.chords, transpose: doc.transpose, times: doc.exportTimes, ending: doc.ending };
    const before = serializeSession(session) + JSON.stringify(request);
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy(true); setProgress(0);
    setStatus(mode === "audition" ? "Rendering the loop for audition…" : "Rendering the loop…");
    void renderChordLoop(session, request, { signal: abort.signal, onProgress: setProgress }).then((result) => {
      const now = chordLoop.getSnapshot().doc;
      const after = serializeSession(captureSession()) + JSON.stringify({ chords: now.chords, transpose: now.transpose, times: now.exportTimes, ending: now.ending });
      if (abort.signal.aborted || before !== after) throw new DOMException("stale", "AbortError");
      const name = exportFileName(request.chords, request.transpose, session.motion.bpm, result.plan.times, request.ending);
      if (mode === "export") {
        download(encodeChordLoopWav(session, request, result), name);
        setStatus(`Exported ${name} · ${result.seconds.toFixed(2)} s${result.plan.note ? ` · ${result.plan.note}` : ""}`);
      } else {
        playPhraseRender(result);
        setStatus(`Playing the rendered ${request.ending === "loop" ? "loop file" : "take"} (${result.seconds.toFixed(2)} s), the same samples as the WAV.`);
      }
    }).catch((error: unknown) => {
      if (abortRef.current !== abort) return; // a newer render owns the status
      if (abort.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        setStatus(abort.signal.aborted ? "Render discarded." : "Render discarded: the sound or the loop changed while it rendered.");
        return;
      }
      setStatus(error instanceof Error ? error.message : "The loop could not be rendered.");
    }).finally(() => {
      if (abortRef.current === abort) setBusy(false);
    });
  };

  const cancel = () => {
    abortRef.current?.abort();
    invalidatePhraseRenders();
    stopPhraseAudition();
    setBusy(false);
    setStatus("Render discarded.");
  };

  return (
    <div className="mb-2 grid gap-2 border-b border-border pb-2" role="group" aria-label="Chord loop">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 font-mono text-xs uppercase tracking-wider text-muted">Chord loop</span>
        <Button variant="outline" aria-label="Add chord" title="Adds the chord you are holding, or the last one you played (Enter)"
          disabled={full || !captured.length} onClick={() => chordLoop.addCapturedChord()}>
          Add chord{captured.length ? ` · ${chordName(captured)}` : ""}
        </Button>
        <Button aria-label={snap.playing ? "Stop chord loop" : "Play chord loop"} disabled={!doc.chords.length && !snap.playing}
          variant={snap.playing ? "solid" : "outline"} aria-pressed={snap.playing}
          onClick={() => snap.playing ? chordLoop.stop() : chordLoop.play()}>{snap.playing ? "Stop" : "Play"}</Button>
        <Button variant="subtle" aria-label="Clear chord loop" disabled={!doc.chords.length}
          onClick={() => { if (window.confirm("Clear every chord in the loop?")) chordLoop.clear(); }}>Clear</Button>
        <label className="flex items-center gap-1.5 font-mono text-xs text-faint">
          New chords
          <select className={field} aria-label="Length of new chords" value={doc.newBeats}
            onChange={(e) => chordLoop.setNewBeats(Number(e.currentTarget.value) as ChordLength)}>
            {CHORD_LENGTHS.map((b) => <option key={b} value={b}>{lengthLabel(b)}</option>)}
          </select>
        </label>
        <Button variant="subtle" aria-label="Give every chord the new-chord length" disabled={!doc.chords.length}
          onClick={() => chordLoop.setAllBeats(doc.newBeats)}>Apply to all</Button>
        <div role="group" aria-label="Transpose chord loop" className="flex items-center gap-1 font-mono text-xs text-faint">
          Transpose
          <Button variant="subtle" size="icon" className="size-8" aria-label="Lower chord loop one semitone"
            disabled={!canTranspose(doc.chords, doc.transpose - 1)} onClick={() => chordLoop.transposeTo(doc.transpose - 1)}>−</Button>
          <output className="min-w-7 text-center tabular-nums text-fg" aria-label="Transpose in semitones">{doc.transpose > 0 ? "+" : ""}{doc.transpose}</output>
          <Button variant="subtle" size="icon" className="size-8" aria-label="Raise chord loop one semitone"
            disabled={!canTranspose(doc.chords, doc.transpose + 1)} onClick={() => chordLoop.transposeTo(doc.transpose + 1)}>+</Button>
          <Button variant="ghost" aria-label="Reset chord loop transpose" disabled={!doc.transpose} onClick={() => chordLoop.transposeTo(0)}>Reset</Button>
        </div>
        <progress className="h-1 w-20 accent-active" aria-label="Chord loop progress" max={1} value={snap.progress} />
      </div>

      {doc.chords.length ? (
        <ol className="flex flex-wrap gap-1.5" aria-label="Chords in the loop">
          {doc.chords.map((chord, i) => {
            const name = chordName(chord.notes, doc.transpose);
            const now = snap.playing && snap.chordIndex === i;
            return (
              <li key={`${i}:${chord.notes.join(".")}:${chord.beats}`} className={cn("flex items-center gap-0.5 rounded-md p-0.5 shadow-border",
                now ? "bg-active text-active-ink" : editing === i ? "bg-active-soft" : "bg-surface-2")}>
                <span className="px-1 font-mono text-[10px] opacity-60">{i + 1}</span>
                <button type="button" className={cn(chip, "font-medium")} aria-expanded={editing === i}
                  aria-label={`Edit voicing for ${name} (chord ${i + 1})`} title={sounding(chord.notes, doc.transpose).map(noteName).join(" ")}
                  onClick={() => setEditing(editing === i ? null : i)}>{name}</button>
                <select className={cn(chip, "bg-transparent")} aria-label={`Length of chord ${i + 1}`} value={chord.beats}
                  onChange={(e) => chordLoop.setChordBeats(i, Number(e.currentTarget.value) as ChordLength)}>
                  {CHORD_LENGTHS.map((b) => <option key={b} value={b}>{lengthLabel(b)}</option>)}
                </select>
                {i > 0 && <button type="button" className={chip} aria-label={`Move chord ${i + 1} earlier`} onClick={() => chordLoop.moveEarlier(i)}>◂</button>}
                <button type="button" className={chip} aria-label={`Remove chord ${i + 1}`} onClick={() => chordLoop.removeChord(i)}>×</button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="font-mono text-[11px] leading-snug text-muted">
          Play a chord, then press Enter (or Add chord) — the chord you just played is kept after you let go. Repeat for each chord, then Play.
        </p>
      )}

      {editing !== null && doc.chords[editing] && (
        <VoicingEditor key={`${editing}:${doc.chords[editing]!.notes.join(",")}`} index={editing}
          original={doc.chords[editing]!.notes} transpose={doc.transpose} held={snap.held}
          canAudition={!snap.playing} onDone={() => setEditing(null)} />
      )}

      {doc.chords.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Export chord loop" aria-busy={busy}>
          <span className="font-mono text-xs text-faint">Export</span>
          <Segmented label="Export ending" value={doc.ending} onChange={(ending: ExportEnding) => chordLoop.setExport(doc.exportTimes, ending)}
            options={[
              { value: "loop", label: "Loop", title: "Seamless: opens with the previous pass's tail and ends where it begins" },
              { value: "take", label: "Take", title: "From silence, with the final tail" },
            ]} />
          <select className={field} aria-label="Times through" value={doc.exportTimes}
            onChange={(e) => chordLoop.setExport(Number(e.currentTarget.value) as ExportTimes, doc.ending)}>
            {EXPORT_TIMES.map((t) => <option key={t} value={t}>{t === 1 ? "Once through" : `${t}× through`}</option>)}
          </select>
          <Button variant="outline" aria-label="Audition chord loop render" disabled={busy || !plan?.ok} onClick={() => render("audition")}>Audition</Button>
          <Button variant="outline" aria-label="Export chord loop WAV" disabled={busy || !plan?.ok} onClick={() => render("export")}>Export WAV</Button>
          {busy && <Button variant="subtle" aria-label="Cancel chord loop render" onClick={cancel}>Cancel</Button>}
          {busy && <progress className="h-1 w-20 accent-active" aria-label="Chord loop render progress" max={1} value={progress} />}
          <span className="font-mono text-[11px] text-muted">
            {plan ? `${plan.loopSeconds.toFixed(2)} s per pass at ${bpm} BPM` : ""}
          </span>
        </div>
      )}
      <p className="font-mono text-[11px] leading-snug text-muted" role="status" aria-live="polite">
        {status || snap.message || (snap.pending ? "Changes apply from the next time through." : plan?.note ?? "")}
      </p>
    </div>
  );
}

/** Re-voice one chord: move notes by octave or semitone, or take the held notes. Stored (untransposed) pitches. */
function VoicingEditor({ index, original, transpose, held, canAudition, onDone }: {
  index: number;
  original: number[];
  transpose: number;
  held: number[];
  canAudition: boolean;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState(original);
  const [selected, setSelected] = useState(original[0]!);
  const ok = (to: number) => midiOK(to) && fitsTranspose([to], transpose) && !notes.includes(to);
  const move = (delta: number) => {
    const to = selected + delta;
    if (!ok(to)) return;
    setNotes(notes.map((n) => n === selected ? to : n).sort((a, b) => a - b));
    setSelected(to);
  };
  const changed = notes.length !== original.length || notes.some((n, i) => n !== original[i]);
  const inRange = fitsTranspose(notes, transpose);
  return (
    <section aria-label="Edit voicing" className="grid gap-2 rounded-md bg-surface-2 p-2 shadow-border">
      <div className="font-mono text-xs">
        Edit voicing · chord {index + 1} · <strong>{chordName(notes, transpose)}</strong>
        {transpose !== 0 && <span className="text-muted"> · entered as {chordName(notes)}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Select a note">
        {notes.map((n) => (
          <button key={n} type="button" aria-pressed={n === selected} onClick={() => setSelected(n)}
            className={cn(chip, n === selected ? "bg-active text-active-ink" : "bg-surface text-fg shadow-border")}>
            {noteName(n + transpose)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="subtle" disabled={!ok(selected - 12)} onClick={() => move(-12)}>− Octave</Button>
        <Button variant="subtle" disabled={!ok(selected + 12)} onClick={() => move(12)}>+ Octave</Button>
        <Button variant="subtle" disabled={!ok(selected - 1)} onClick={() => move(-1)}>− Semitone</Button>
        <Button variant="subtle" disabled={!ok(selected + 1)} onClick={() => move(1)}>+ Semitone</Button>
        <Button variant="subtle" disabled={notes.length < 2} onClick={() => {
          const rest = notes.filter((n) => n !== selected);
          setNotes(rest); setSelected(rest[0]!);
        }}>Remove note</Button>
        <Button variant="subtle" disabled={!held.length} title="Replace this chord with the notes you are holding"
          onClick={() => { const shape = held.map((n) => n - transpose).filter(midiOK); if (shape.length) { setNotes(shape); setSelected(shape[0]!); } }}>Use held notes</Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="outline" disabled={!canAudition || !inRange} title={canAudition ? "Hear this voicing for a second" : "Stop the chord loop to audition"}
          onClick={() => chordLoop.audition(notes)}>Audition</Button>
        <Button variant="solid" disabled={!changed || !inRange} onClick={() => { chordLoop.replaceChord(index, notes); onDone(); }}>Apply</Button>
        <Button variant="subtle" onClick={onDone}>Cancel</Button>
        <span className="font-mono text-[11px] text-muted">{sounding(notes, transpose).map(noteName).join(" ")}</span>
        {!inRange && <span className="font-mono text-[11px] text-muted">Outside the note range at this transpose.</span>}
      </div>
    </section>
  );
}

