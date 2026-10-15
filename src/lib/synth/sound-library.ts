import { SoundFileError, parseSound, type SoundSnapshot } from "./sound-file";

/** The subset of Web Storage used here, so tests can supply a plain map. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const CURRENT_SOUND_KEY = "phosphor.sound.current.v1";
export const SOUND_LIBRARY_KEY = "phosphor.sounds.v1";
export const SOUND_LIBRARY_LIMIT = 48;

export type LibraryEntry = { id: string; sound: SoundSnapshot };
export type LibraryRead = { entries: LibraryEntry[]; skipped: number };

function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function storageError(error: unknown): SoundFileError {
  const name = (error as { name?: string } | null)?.name;
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
    return new SoundFileError("Browser storage is full. Delete a saved sound or download it as a file.");
  }
  return new SoundFileError("This browser would not save the sound. Download it as a file instead.");
}

/**
 * Sounds kept in this browser: an automatic "current sound" that survives
 * reloads, and a small named library. Every read is validated; anything that
 * fails validation is ignored rather than loaded.
 */
export class SoundLibrary {
  private store: KeyValueStore | null;
  private listeners = new Set<() => void>();
  /** Increments on every library change, for React's external-store snapshot. */
  version = 0;

  constructor(store: KeyValueStore | null) {
    this.store = store;
  }

  get available(): boolean {
    return this.store !== null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private changed() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  private write(key: string, value: string) {
    if (!this.store) throw new SoundFileError("This browser has no storage for sounds. Download them as files instead.");
    try {
      this.store.setItem(key, value);
    } catch (error) {
      throw storageError(error);
    }
  }

  private read(key: string): string | null {
    try {
      return this.store?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  readCurrent(): SoundSnapshot | null {
    const text = this.read(CURRENT_SOUND_KEY);
    if (!text) return null;
    try {
      return parseSound(JSON.parse(text));
    } catch {
      // A damaged autosave must never stop the instrument from opening.
      try {
        this.store?.removeItem(CURRENT_SOUND_KEY);
      } catch {
        /* ignore */
      }
      return null;
    }
  }

  writeCurrent(sound: SoundSnapshot) {
    this.write(CURRENT_SOUND_KEY, JSON.stringify(sound));
  }

  list(): LibraryRead {
    const text = this.read(SOUND_LIBRARY_KEY);
    if (!text) return { entries: [], skipped: 0 };
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { entries: [], skipped: 1 };
    }
    if (!Array.isArray(raw)) return { entries: [], skipped: 1 };
    const entries: LibraryEntry[] = [];
    let skipped = 0;
    for (const item of raw) {
      try {
        const id = (item as { id?: unknown }).id;
        if (typeof id !== "string" || !id) throw new SoundFileError("Missing id.");
        entries.push({ id, sound: parseSound((item as { sound?: unknown }).sound) });
      } catch {
        skipped++;
      }
    }
    entries.sort((a, b) => Date.parse(b.sound.savedAt) - Date.parse(a.sound.savedAt));
    return { entries, skipped };
  }

  /** Saves under the sound's name, replacing an existing entry with the same name. */
  save(sound: SoundSnapshot): LibraryEntry {
    // A save rewrites the list from its valid entries; unreadable ones are dropped.
    const { entries } = this.list();
    const existing = entries.find((e) => e.sound.name.toLowerCase() === sound.name.toLowerCase());
    if (!existing && entries.length >= SOUND_LIBRARY_LIMIT) {
      throw new SoundFileError(`The library holds ${SOUND_LIBRARY_LIMIT} sounds. Delete one first, or download this sound as a file.`);
    }
    const entry = { id: existing?.id ?? newId(), sound };
    const next = [entry, ...entries.filter((e) => e.id !== entry.id)];
    this.write(SOUND_LIBRARY_KEY, JSON.stringify(next));
    this.changed();
    return entry;
  }

  remove(id: string) {
    const { entries } = this.list();
    this.write(SOUND_LIBRARY_KEY, JSON.stringify(entries.filter((e) => e.id !== id)));
    this.changed();
  }
}

/** Web Storage can throw on access (privacy modes, sandboxed frames). */
export function browserStorage(): KeyValueStore | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const probe = "phosphor.probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}
