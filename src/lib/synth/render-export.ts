import { synth } from "./engine";
import { noteLooper } from "./looper-runtime";
import { RENDER_SAMPLE_RATE, renderTake, type RenderMode, type RenderResult } from "./loop-render";
import { soundSession } from "./sound-session";
import { useSynthStore } from "./store";
import { encodeFloatWav } from "./wav";

export type TakeExport = { file: File; result: RenderResult };

function wavName(sound: string, mode: RenderMode, bpm: number): string {
  const base = sound.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") || "phosphor";
  return `${base.slice(0, 50)}-${Math.round(bpm)}bpm-${mode === "seamless" ? "loop" : "take"}.wav`;
}

/**
 * Renders the current note-loop take with the current sound. Motion is included
 * when it is playing at the moment of export, restarted from bar 1.
 */
export async function exportTakeWav(mode: RenderMode): Promise<TakeExport> {
  const loop = noteLooper.getSnapshot();
  if (!loop.hasTake) throw new Error("Record a take first.");
  const sound = soundSession.snapshot();
  const includeMotion = useSynthStore.getState().motionPlaying;
  // Render at the rate this device plays at. Space builds its reverb sample by
  // sample, so the same sound differs between 44.1 and 48 kHz devices.
  const sampleRate = synth.getContext()?.sampleRate ?? RENDER_SAMPLE_RATE;
  const result = await renderTake({
    sampleRate,
    sound,
    events: noteLooper.getEvents(),
    bars: loop.bars,
    mode,
    includeMotion,
  });
  const seconds = result.channels[0]!.length / result.sampleRate;
  const bytes = encodeFloatWav(result.channels, result.sampleRate, {
    title: sound.name,
    software: "Phosphor",
    comment: `${loop.bars} bar${loop.bars === 1 ? "" : "s"} at ${sound.motion.bpm} BPM, ${mode === "seamless" ? "seamless loop" : "take with tail"}, ${seconds.toFixed(2)} s${result.motion ? ", with Motion" : ""}.`,
    json: result.provenance,
  });
  const file = new File([bytes.buffer as ArrayBuffer], wavName(sound.name, mode, sound.motion.bpm), { type: "audio/wav" });
  return { file, result };
}
