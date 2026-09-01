import { useEffect } from "react";
import { synth } from "@/lib/synth/engine";
import { useSynthStore } from "@/lib/synth/store";
import { midiFromCode } from "@/lib/synth/keyboard-map";
import { useTreatment } from "@/lib/presentation/treatment";
import { isEditableTarget } from "@/lib/utils";
import { WaveformEditor } from "./waveform-editor";
import { MotionEditor } from "./motion-editor";
import { MotionPlaybackController } from "./motion-playback";
import { Oscilloscope } from "./oscilloscope";
import { Piano } from "./piano";
import { HeaderBar, PresetBar, SideParams } from "./controls";
import { MorphBar } from "./morph-bar";
import { SpaceBar } from "./space-bar";
import { DriveBar } from "./drive-bar";
import { ChorusBar } from "./chorus-bar";

type PhosphorDebug = {
  peak: () => number;
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

    const onKeyDown = (e: KeyboardEvent) => {
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
      if (e.code === "Escape") {
        e.preventDefault();
        held.clear();
        useSynthStore.getState().stopMotion();
        synth.allNotesOff();
        return;
      }
      const midi = midiFromCode(e.code, useSynthStore.getState().octave);
      if (midi === null) return;
      e.preventDefault();
      if (held.has(e.code)) return;
      held.set(e.code, midi);
      synth.unlock();
      synth.noteOn(midi);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const midi = held.get(e.code);
      if (midi === undefined) return;
      held.delete(e.code);
      synth.noteOff(midi);
    };

    const panic = () => {
      held.clear();
      useSynthStore.getState().stopMotion();
      synth.allNotesOff();
    };

    const onVisibility = () => {
      if (document.hidden) panic();
      else if (synth.ready) synth.unlock();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", panic);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", panic);
      document.removeEventListener("visibilitychange", onVisibility);
      panic();
    };
  }, []);

  return (
    <div
      data-phosphor-treatment={treatment}
      className="flex h-dvh flex-col overflow-hidden bg-bg text-fg"
      tabIndex={0}
      onPointerDown={() => synth.unlock()}
    >
      <MotionPlaybackController />
      <div className="mx-auto flex min-h-0 w-full max-w-[92rem] flex-1 flex-col gap-2 overflow-hidden px-3 py-2 sm:px-5 sm:py-4 md:gap-3">
        <div className="shrink-0">
          <HeaderBar />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            {domain === "motion" ? <MotionEditor /> : <WaveformEditor />}
            <div className="shrink-0">
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
          </div>
          <div className="flex w-full min-h-0 flex-col gap-3 lg:w-72 lg:shrink-0">
            <Oscilloscope />
            <SideParams />
          </div>
        </div>

        <div className="shrink-0">
          <PresetBar />
        </div>

        <section className="shrink-0 overflow-hidden rounded-xl bg-surface p-2 shadow-border pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Piano />
        </section>
      </div>
    </div>
  );
}
