import demos from "../../../contributor-kit/demos.json" with { type: "json" };
import { createFactorySession } from "./session-apply";
import { parseSessionDocument } from "./session-file";
import { soundToSession, parseSound, type SoundDocument } from "./sound-file";
import { type Role } from "./preset-pack";
import { renderPhrase, type PhraseRenderOptions } from "./phrase-render";

/** A disposable performance document; never installed in the user's note looper. */
export function demoSession(sound: SoundDocument, role: Role, motion: boolean, bpm = demos.bpm, volume = 0.72) {
  const session = soundToSession(parseSound(sound), createFactorySession());
  session.motion.bpm = bpm;
  session.output.volume = volume;
  session.noteLoop = structuredClone(demos.phrases[role]) as typeof session.noteLoop;
  if (!motion) for (const route of Object.values(session.motion.routes)) route.enabled = false;
  return parseSessionDocument(session);
}

export function renderPreset(sound: SoundDocument, role: Role, motion: boolean, bpm = demos.bpm, volume = 0.72, options: PhraseRenderOptions = {}) {
  return renderPhrase(demoSession(sound, role, motion, bpm, volume), options);
}
