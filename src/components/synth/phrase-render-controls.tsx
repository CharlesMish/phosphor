import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { synth } from "@/lib/synth/engine";
import { noteLooper } from "@/lib/synth/looper-runtime";
import {
  beginPhraseJob,
  downloadPhraseWav,
  encodePhraseWav,
  invalidatePhraseRenders,
  playPhraseRender,
  renderCapturedPhrase,
  stopPhraseAudition,
} from "@/lib/synth/phrase-export";
import { captureSession } from "@/lib/synth/session-apply";
import { useSynthStore } from "@/lib/synth/store";

const POLICY =
  "Render from start: time zero is beat 1, leading rests stay, and there is no count-in. Motion restarts with the notes. Audition plays that 48 kHz render. Ordinary Play keeps its own loop and is not synced to this clock.";

export function PhraseRenderControls({ hasTake }: { hasTake: boolean }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState(POLICY);
  const abortRef = useRef<AbortController | null>(null);

  const stop = () => {
    abortRef.current?.abort();
    invalidatePhraseRenders();
    stopPhraseAudition();
    setBusy(false);
    setStatus("Render discarded.");
  };

  const run = (mode: "audition" | "export") => {
    const loop = noteLooper.getSnapshot();
    if (loop.state === "recording" || !loop.hasTake) return;
    abortRef.current?.abort();
    stopPhraseAudition();
    if (loop.state === "playing") noteLooper.stop();
    useSynthStore.getState().stopMotion();
    synth.allNotesOff();
    const session = captureSession();
    const job = beginPhraseJob();
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy(true);
    setProgress(0);
    setStatus(mode === "audition" ? "Rendering the phrase for audition…" : "Rendering the phrase…");
    void renderCapturedPhrase(session, job, {
      signal: abort.signal,
      onProgress: (ratio) => setProgress(ratio),
    }).then((result) => {
      if (abort.signal.aborted) return;
      if (mode === "export") {
        downloadPhraseWav(encodePhraseWav(session, result), session.motion.bpm);
        setStatus("Exported one phrase plus its tail. This is not a recording of live playback.");
      } else {
        playPhraseRender(result);
        setStatus("Audition is playing the rendered phrase, from beat 1, with the same samples as the WAV.");
      }
    }).catch((error: unknown) => {
      if (abort.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        setStatus("Render discarded. The session was left unchanged.");
        return;
      }
      const message = error instanceof Error ? error.message : "The phrase could not be rendered.";
      setStatus(message);
    }).finally(() => {
      if (abortRef.current === abort) setBusy(false);
    });
  };

  return (
    <div className="basis-full" role="group" aria-label="Render from start" aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          aria-label="Audition from start"
          disabled={!hasTake || busy}
          onClick={() => run("audition")}
        >
          Audition from start
        </Button>
        <Button
          variant="outline"
          aria-label="Export phrase WAV"
          disabled={!hasTake || busy}
          onClick={() => run("export")}
        >
          Export WAV
        </Button>
        {busy ? (
          <Button variant="subtle" aria-label="Cancel phrase render" onClick={stop}>Cancel</Button>
        ) : null}
        {busy ? (
          <progress className="h-1 w-20 accent-active" aria-label="Phrase render progress" max={1} value={progress} />
        ) : null}
      </div>
      <p id="phrase-render-status" className="mt-1 font-mono text-[11px] leading-snug text-muted" role="status">
        {status}
      </p>
    </div>
  );
}
