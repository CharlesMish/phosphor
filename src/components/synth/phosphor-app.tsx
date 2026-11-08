import { useEffect } from "react";
import { synth } from "@/lib/synth/engine";
import { useSynthStore } from "@/lib/synth/store";
import { midiFromCode, octaveStep } from "@/lib/synth/keyboard-map";
import { getKeyLayout } from "@/lib/synth/key-layout-pref";
import { chordLoop } from "@/lib/synth/chord-loop-runtime";
import { useTreatment } from "@/lib/presentation/treatment";
import { isEditableTarget } from "@/lib/utils";
import { WaveformEditor } from "./waveform-editor";
import { MotionEditor } from "./motion-editor";
import { MotionPlaybackController } from "./motion-playback";
import { Oscilloscope } from "./oscilloscope";
import { NoteLooperControls } from "./note-looper";
import { ChordLoopControls } from "./chord-loop";
import { connectLooperTempo, panicPerformance, performanceInput } from "@/lib/synth/looper-runtime";
import { stopPhraseAudition, invalidatePhraseRenders } from "@/lib/synth/phrase-export";
import { startSessionAutosave } from "@/lib/synth/session-apply";
import { Piano } from "./piano";
import { HeaderBar, KeyboardControls, PresetBar, SideParams } from "./controls";
import { EffectsSummary } from "./effects-summary";
import { MorphBar } from "./morph-bar";
import { SpaceBar } from "./space-bar";
import { DriveBar } from "./drive-bar";
import { ChorusBar } from "./chorus-bar";

type PhosphorDebug = {
  peak: () => number;
  driveInputRange: () => { min: number; max: number };
  mix: () => number;
  length: () => number;
  domain: () => string;
  seed: () => number;
  contour: () => number[];
  view: () => number[];
  samples: () => number[];
  driveCurve: () => number[];
  preset: () => string;
  spacePreset: () => string;
  voices: () => number[];
};

export function PhosphorApp() {
  const setActiveNotes = useSynthStore((s) => s.setActiveNotes);
  const setAudioReady = useSynthStore((s) => s.setAudioReady);
  const domain = useSynthStore((s) => s.domain);
  const { treatment } = useTreatment();

  useEffect(() => {
    const unvoice = synth.onVoices(setActiveNotes);
    const unready = synth.onReady(setAudioReady);
    return () => {
      unvoice();
      unready();
    };
  }, [setActiveNotes, setAudioReady]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as Window & { __phosphor?: PhosphorDebug };
    w.__phosphor = {
      peak: () => synth.measurePeak(),
      driveInputRange: () => synth.measureDriveInputRange(),
      mix: () => useSynthStore.getState().spaceMix,
      length: () => useSynthStore.getState().spaceSeconds,
      domain: () => useSynthStore.getState().domain,
      seed: () => useSynthStore.getState().spaceSeed,
      contour: () => useSynthStore.getState().spaceContour.slice(),
      view: () => useSynthStore.getState().spaceView.slice(),
      samples: () => useSynthStore.getState().samples.slice(),
      driveCurve: () => useSynthStore.getState().driveCurve.slice(),
      preset: () => String(useSynthStore.getState().preset),
      spacePreset: () => String(useSynthStore.getState().spacePreset),
      voices: () => useSynthStore.getState().activeNotes.slice(),
    };
    return () => {
      delete w.__phosphor;
    };
  }, []);

  useEffect(() => {
    const held = new Map<string, number>();
    const unreset = performanceInput.onReset(() => held.clear());
    // Browsers focus a button when it is clicked. Such a button must not keep
    // Enter (it would press Play/Remove again); one reached by Tab does.
    let pointerFocused: Element | null = null;
    const onPointerDown = (e: PointerEvent) => {
      pointerFocused = e.target instanceof Element ? e.target.closest("button, a, select, summary") : null;
    };
    const onFocusIn = (e: FocusEvent) => {
      if (e.target !== pointerFocused) pointerFocused = null;
    };
    const untempo = connectLooperTempo();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        invalidatePhraseRenders(); stopPhraseAudition();
        panicPerformance();
        return;
      }
      if (e.repeat) return;
      if (isEditableTarget(e.target)) return;

      if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey) useSynthStore.getState().redo();
        else useSynthStore.getState().undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyY") {
        e.preventDefault();
        useSynthStore.getState().redo();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const step = octaveStep(e.code);
      if (step !== 0) {
        e.preventDefault();
        const store = useSynthStore.getState();
        store.setOctave(store.octave + step);
        return;
      }
      // Enter adds the held (or last played) chord to the chord loop. A focused
      // button keeps Enter for itself.
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        const control = e.target instanceof Element ? e.target.closest("button, a, select, summary") : null;
        if (control && control !== pointerFocused) return;
        e.preventDefault();
        chordLoop.addCapturedChord();
        return;
      }
      const midi = midiFromCode(e.code, useSynthStore.getState().octave, getKeyLayout());
      if (midi === null) return;
      e.preventDefault();
      if (held.has(e.code)) return;
      performanceInput.noteOn(`qwerty:${e.code}`, midi);
      held.set(e.code, midi);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const midi = held.get(e.code);
      if (midi === undefined) return;
      held.delete(e.code);
      performanceInput.noteOff(`qwerty:${e.code}`);
    };

    const panic = () => {
      held.clear();
      invalidatePhraseRenders(); stopPhraseAudition();
      panicPerformance();
    };

    const onVisibility = () => {
      if (document.hidden) panic();
      else if (synth.ready) synth.unlock();
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", panic);
    document.addEventListener("visibilitychange", onVisibility);
    const stopAutosave = startSessionAutosave();

    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", panic);
      document.removeEventListener("visibilitychange", onVisibility);
      stopAutosave();
      panic();
      unreset();
      untempo();
    };
  }, []);

  return (
    <div
      data-phosphor-treatment={treatment}
      className="phosphor-app bg-bg text-fg"
      tabIndex={0}
      onPointerDown={() => synth.unlock()}
    >
      <MotionPlaybackController />
      <main className="phosphor-shell">
        <div className="phosphor-heading shrink-0">
          <HeaderBar />
        </div>

        <div className="phosphor-workspace">
          <section className="phosphor-drawing" aria-label="Sound editor">
            {domain === "motion" ? <MotionEditor /> : <WaveformEditor />}
            <div className="phosphor-editor-tools">
              <PresetBar />
            </div>
            <div className="phosphor-domain-controls shrink-0">
              {domain === "space" ? (
                <SpaceBar />
              ) : domain === "drive" ? (
                <DriveBar />
              ) : domain === "chorus" ? (
                <ChorusBar />
              ) : (
                <MorphBar />
              )}
            </div>
          </section>
          <aside className="phosphor-output" aria-label="Output and sound settings">
            <Oscilloscope />
            <SideParams />
            <EffectsSummary />
          </aside>
        </div>

        <section className="phosphor-keyboard shrink-0 rounded-xl bg-surface p-2 shadow-border pb-[max(0.5rem,env(safe-area-inset-bottom))]" aria-label="Keyboard">
          <KeyboardControls />
          <NoteLooperControls />
          <ChordLoopControls />
          <Piano />
        </section>
      </main>
    </div>
  );
}
