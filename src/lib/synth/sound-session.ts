import { synth } from "./engine";
import { noteLooper, performanceInput } from "./looper-runtime";
import { captureSession, patchFrom } from "./session-apply";
import { parseSound, soundFromSession, soundToSession } from "./sound-file";
import { useSynthStore } from "./store";
import { invalidatePhraseRenders, stopPhraseAudition } from "./phrase-export";

let switching = false;
export const captureSound = () => soundFromSession(captureSession());

/** Sound-only application. Session restore remains the only whole-workspace writer. */
export async function applySound(input: unknown) {
  const sound = parseSound(input); // Complete validation before stopping or mutating anything.
  if (noteLooper.getSnapshot().state === "recording") throw new Error("Finish recording before changing sounds. Your take is untouched.");
  if (switching) throw new Error("A sound is already changing. Try again in a moment.");
  switching = true;
  const rollback = captureSession();
  try {
    invalidatePhraseRenders();
    stopPhraseAudition();
    noteLooper.stop(); // Keeps events, bars and BPM; clears physical input ownership.
    useSynthStore.getState().stopMotion();
    await synth.beginSoundSwitch();
    const workspace = captureSession();
    useSynthStore.getState().replaceSavedSession(patchFrom(soundToSession(sound, workspace)));
  } catch (error) {
    useSynthStore.getState().replaceSavedSession(patchFrom(rollback));
    throw error;
  } finally {
    performanceInput.reset();
    synth.finishSoundSwitch();
    switching = false;
  }
}
