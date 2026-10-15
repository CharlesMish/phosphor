import { useSynthStore, DEFAULT_SOUND_SOURCE } from "./store";
import {
  SoundFileError,
  cleanSoundName,
  parseSoundText,
  snapshotSound,
  soundFileName,
  type SoundSnapshot,
  type SoundSource,
} from "./sound-file";
import { SoundLibrary, browserStorage } from "./sound-library";

export const AUTOSAVE_DELAY_MS = 400;

const SOURCE_KEYS: (keyof SoundSource)[] = [
  "samples", "preset", "slotA", "slotB", "morph", "morphLive",
  "attack", "release", "cutoff", "volume",
  "driveCurve", "drivePreset", "driveAmount", "driveSafe",
  "chorusCurve", "chorusPreset", "chorusPeriod", "chorusMix",
  "spaceContour", "spaceSeed", "spacePreset", "spaceMetal", "spaceMix", "spaceSeconds",
  "motionPath", "motionBpm", "motionBeats", "motionMode", "motionRoutes",
];

export type SessionState = {
  name: string;
  /** Library entry the current sound was last saved to or loaded from. */
  entryId: string | null;
  /** Last problem to show the player, or a short confirmation. */
  message: string;
  autosaved: boolean;
};

/**
 * Connects the instrument to sound storage: restores the last sound on load,
 * autosaves edits, and manages the named library and sound files.
 */
export class SoundSession {
  readonly library: SoundLibrary;
  private state: SessionState = { name: "Untitled sound", entryId: null, message: "", autosaved: false };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(library: SoundLibrary) {
    this.library = library;
  }

  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private update(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  snapshot(name = this.state.name): SoundSnapshot {
    return snapshotSound(useSynthStore.getState(), name);
  }

  /** Called once before the first render. Returns true when a sound was restored. */
  restore(): boolean {
    const sound = this.library.readCurrent();
    if (!sound) return false;
    useSynthStore.getState().loadSound(sound);
    this.update({ name: sound.name, autosaved: true });
    return true;
  }

  /** Autosaves the current sound shortly after any sound-defining edit. */
  connect(): () => void {
    const unsubscribe = useSynthStore.subscribe((state, previous) => {
      // Motion playback animates routed values every frame; save once it stops.
      if (state.motionPlaying) return;
      if (!SOURCE_KEYS.some((key) => state[key] !== previous[key]) && state.motionPlaying === previous.motionPlaying) return;
      this.schedule();
    });
    return () => {
      unsubscribe();
      this.flush();
    };
  }

  private schedule() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), AUTOSAVE_DELAY_MS);
  }

  flush() {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.library.available) return;
    try {
      this.library.writeCurrent(this.snapshot());
      if (!this.state.autosaved) this.update({ autosaved: true });
    } catch (error) {
      this.update({ autosaved: false, message: errorText(error) });
    }
  }

  setName(name: string) {
    this.update({ name: name.slice(0, 80), entryId: null });
    this.schedule();
  }

  saveToLibrary(): boolean {
    try {
      const name = cleanSoundName(this.state.name);
      const entry = this.library.save(this.snapshot(name));
      this.update({ name, entryId: entry.id, message: `Saved “${name}” in this browser.` });
      this.flush();
      return true;
    } catch (error) {
      this.update({ message: errorText(error) });
      return false;
    }
  }

  load(sound: SoundSnapshot, entryId: string | null, message: string) {
    useSynthStore.getState().loadSound(sound);
    this.update({ name: sound.name, entryId, message });
    this.schedule();
  }

  loadEntry(id: string) {
    const entry = this.library.list().entries.find((e) => e.id === id);
    if (!entry) {
      this.update({ message: "That saved sound could not be read." });
      return;
    }
    this.load(entry.sound, entry.id, `Loaded “${entry.sound.name}”.`);
  }

  removeEntry(id: string) {
    try {
      const entry = this.library.list().entries.find((e) => e.id === id);
      this.library.remove(id);
      this.update({
        entryId: this.state.entryId === id ? null : this.state.entryId,
        message: entry ? `Deleted “${entry.sound.name}” from this browser.` : "",
      });
    } catch (error) {
      this.update({ message: errorText(error) });
    }
  }

  newSound() {
    const sound = snapshotSound(DEFAULT_SOUND_SOURCE, "Untitled sound");
    this.load(sound, null, "Started a new sound.");
  }

  /** The current sound as a portable `.phosphor.json` file. */
  file(): File {
    const sound = this.snapshot();
    return new File([JSON.stringify(sound, null, 1)], soundFileName(sound.name), { type: "application/json" });
  }

  async open(file: Blob): Promise<boolean> {
    try {
      if (file.size > 2_000_000) throw new SoundFileError("That file is too large to be a Phosphor sound.");
      const sound = parseSoundText(await file.text());
      this.load(sound, null, `Opened “${sound.name}”.`);
      return true;
    } catch (error) {
      this.update({ message: errorText(error) });
      return false;
    }
  }

  clearMessage() {
    if (this.state.message) this.update({ message: "" });
  }
}

function errorText(error: unknown): string {
  if (error instanceof SoundFileError) return error.message;
  return "Something went wrong with that sound.";
}

export const soundSession = new SoundSession(new SoundLibrary(browserStorage()));
