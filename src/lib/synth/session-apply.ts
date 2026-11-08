import { parseSound, soundToSession, parseJsonFile } from "./sound-file";
import { noteLooper } from "./looper-runtime";
import {
  parseSessionDocument,
  serializeSession,
  SESSION_STORAGE_KEY,
  SESSION_VERSION,
  type SessionDocument,
} from "./session-file";
import { useSynthStore, type SavedSessionPatch } from "./store";

export type SessionStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type LocalRestoreReport = "restored" | "migrated" | "empty" | "rejected" | "unavailable";

export let localRestoreReport: LocalRestoreReport = "empty";

function browserStorage(): SessionStorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const probe = `${SESSION_STORAGE_KEY}.probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export function patchFrom(document: SessionDocument): SavedSessionPatch {
  return {
    domain: document.domain,
    samples: document.cycle.samples,
    preset: document.cycle.preset,
    hasDrawn: document.cycle.hasDrawn,
    slotA: document.cycle.slotA,
    slotB: document.cycle.slotB,
    morph: document.cycle.morph,
    morphLive: document.cycle.morphLive,
    attack: document.envelope.attack,
    release: document.envelope.release,
    cutoff: document.filter.cutoff,
    volume: document.output.volume,
    trimDb: document.output.trimDb,
    octave: document.output.octave,
    driveCurve: document.drive.curve,
    drivePreset: document.drive.preset,
    driveAmount: document.drive.amount,
    driveSafe: document.drive.safe,
    driveHasDrawn: document.drive.hasDrawn,
    chorusCurve: document.chorus.curve,
    chorusPreset: document.chorus.preset,
    chorusPeriod: document.chorus.period,
    chorusMix: document.chorus.mix,
    spaceContour: document.space.contour,
    spaceSeed: document.space.seed,
    spacePreset: document.space.preset,
    spaceMetal: document.space.metal,
    spaceMix: document.space.mix,
    spaceSeconds: document.space.seconds,
    spaceHasDrawn: document.space.hasDrawn,
    motionPath: document.motion.path,
    motionBpm: document.motion.bpm,
    motionBeats: document.motion.beats,
    motionMode: document.motion.mode,
    motionRoutes: document.motion.routes,
  };
}

/** The current completed session. A recording in progress contributes no note events. */
export function captureSession(): SessionDocument {
  const state = useSynthStore.getState();
  const take = noteLooper.completedTake();
  return parseSessionDocument({
    format: "phosphor-session",
    version: SESSION_VERSION,
    domain: state.domain,
    cycle: {
      samples: state.samples,
      preset: state.preset,
      hasDrawn: state.hasDrawn,
      slotA: state.slotA,
      slotB: state.slotB,
      morph: state.morph,
      morphLive: state.morphLive,
    },
    envelope: { attack: state.attack, release: state.release },
    filter: { cutoff: state.cutoff },
    output: { volume: state.volume, octave: state.octave, trimDb: state.trimDb },
    drive: {
      curve: state.driveCurve,
      preset: state.drivePreset,
      amount: state.driveAmount,
      safe: state.driveSafe,
      hasDrawn: state.driveHasDrawn,
    },
    chorus: {
      curve: state.chorusCurve,
      preset: state.chorusPreset,
      period: state.chorusPeriod,
      mix: state.chorusMix,
    },
    space: {
      contour: state.spaceContour,
      seed: state.spaceSeed,
      preset: state.spacePreset,
      metal: state.spaceMetal,
      mix: state.spaceMix,
      seconds: state.spaceSeconds,
      hasDrawn: state.spaceHasDrawn,
    },
    motion: {
      path: state.motionPath,
      mode: state.motionMode,
      bpm: state.motionBpm,
      beats: state.motionBeats,
      routes: state.motionRoutes,
    },
    noteLoop: take,
  });
}

const factorySession = captureSession();

export function createFactorySession(): SessionDocument {
  return parseSessionDocument(JSON.parse(serializeSession(factorySession)));
}

function install(document: SessionDocument) {
  useSynthStore.getState().stopMotion();
  useSynthStore.getState().replaceSavedSession(patchFrom(document));
  noteLooper.loadTake(document.noteLoop.bars, document.noteLoop.events);
  noteLooper.setBpm(document.motion.bpm);
}

/**
 * Validate the whole document, then replace the session. A malformed file
 * throws with the live session unchanged. Playback is left stopped.
 */
export function applySession(input: unknown) {
  const document = parseSessionDocument(input);
  const rollback = captureSession();
  try {
    install(document);
  } catch (error) {
    try {
      install(rollback);
    } catch {
      /* The previous completed session could not be put back. */
    }
    throw error;
  }
}

export function restoreLocalSession(storage: SessionStorageLike | null = browserStorage()): LocalRestoreReport {
  if (!storage) {
    localRestoreReport = "unavailable";
    return localRestoreReport;
  }
  let raw: string | null;
  try { raw = storage.getItem(SESSION_STORAGE_KEY); }
  catch { localRestoreReport = "unavailable"; return localRestoreReport; }
  if (!raw) {
    try {
      const oldSession = storage.getItem("phosphor.session.v1");
      const oldSound = storage.getItem("phosphor.sound.current.v1");
      if (oldSession) {
        applySession(parseJsonFile(oldSession));
        localRestoreReport = "migrated"; return localRestoreReport;
      }
      if (oldSound) {
        const data = parseJsonFile(oldSound) as { voice: { volume: number }; motion: { bpm: number } };
        const sound = parseSound(data);
        const workspace = createFactorySession();
        // This is startup workspace restoration, not a library sound switch.
        workspace.output.volume = data.voice.volume;
        workspace.motion.bpm = data.motion.bpm;
        applySession(soundToSession(sound, workspace));
        localRestoreReport = "migrated"; return localRestoreReport;
      }
    } catch { localRestoreReport = "rejected"; return localRestoreReport; }
  }
  if (!raw) {
    localRestoreReport = "empty";
    return localRestoreReport;
  }
  try {
    applySession(parseJsonFile(raw));
    localRestoreReport = "restored";
  } catch {
    try {
      storage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      /* Ignore a storage that cannot be cleaned. */
    }
    localRestoreReport = "rejected";
  }
  return localRestoreReport;
}

export function writeLocalSession(storage: SessionStorageLike | null = browserStorage()) {
  if (!storage) return;
  if (noteLooper.getSnapshot().state === "recording") return;
  storage.setItem(SESSION_STORAGE_KEY, serializeSession(captureSession()));
}

/** Write the completed session after edits settle, and immediately when the page hides. */
export function startSessionAutosave(storage: SessionStorageLike | null = browserStorage()): () => void {
  if (!storage) return () => {};
  let timer = 0;
  let last = storage.getItem(SESSION_STORAGE_KEY);
  const write = () => {
    timer = 0;
    if (noteLooper.getSnapshot().state === "recording") return;
    try {
      const text = serializeSession(captureSession());
      if (text === last) return;
      storage.setItem(SESSION_STORAGE_KEY, text);
      last = text;
    } catch {
      /* Private mode and quota failures leave the memory session in place. */
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(write, 400) as unknown as number;
  };
  const onStore = useSynthStore.subscribe(schedule);
  const onLoop = noteLooper.subscribe(schedule);
  const onHide = () => {
    clearTimeout(timer);
    timer = 0;
    write();
  };
  if (typeof window !== "undefined") window.addEventListener("pagehide", onHide);
  return () => {
    clearTimeout(timer);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", onHide);
    onStore();
    onLoop();
  };
}
