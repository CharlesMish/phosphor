import { parseJsonFile, parseSound, type SoundDocument } from "./sound-file";
import { auditionId, defaultMetadata, parseEntry, parsePack, type PresetEntry, type PresetMetadata, type PresetPack } from "./preset-pack";

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const SOUND_LIBRARY_KEY = "phosphor.sounds.v2";
export const LEGACY_LIBRARY_KEY = "phosphor.sounds.v1";
export const CURRENT_SOUND_KEY = "phosphor.sound.current.v1";
export const SOUND_LIBRARY_LIMIT = 192;
type SavedEntry = { entry: PresetEntry; editable: boolean };
type Shelf = { entries: SavedEntry[]; favorites: string[] };

export function browserStorage(): KeyValueStore | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    s.setItem("phosphor.library.probe", "1"); s.removeItem("phosphor.library.probe");
    return s;
  } catch { return null; }
}

export function legacyEntry(input: unknown, id: string): PresetEntry {
  const legacy = input as { name?: string; motion?: { bpm?: number } };
  const sound = parseSound(input);
  const metadata = defaultMetadata(legacy.name || "Imported sound");
  metadata.recommendedBpm = legacy.motion?.bpm ?? null;
  metadata.provenance = "Migrated PR #15 sound v1. Volume was a monitor setting and is not adopted. Tempo is a recommendation; raw A/B endpoints retained.";
  return parseEntry({ id, version: 1, sound, metadata });
}

/** Replaces PR #15's name-overwrite policy; old keys are read-only migration sources. */
export class SoundLibrary {
  version = 0;
  warning = "";
  private memory: Shelf = { entries: [], favorites: [] };
  private listeners = new Set<() => void>();
  private store: KeyValueStore | null;
  private factory: PresetEntry[];
  constructor(store: KeyValueStore | null, factory: PresetEntry[]) {
    this.store = store; this.factory = factory;
    try {
      if (store && !store.getItem(SOUND_LIBRARY_KEY)) {
        const raw = store.getItem(LEGACY_LIBRARY_KEY);
        if (raw) {
          const rows = parseJsonFile(raw);
          if (!Array.isArray(rows) || rows.length > SOUND_LIBRARY_LIMIT) throw new Error("Invalid legacy shelf.");
          const ids = new Set<string>();
          const entries = rows.map(row => {
            if (typeof row.id !== "string" || !row.id || ids.has(row.id)) throw new Error("Invalid or duplicate legacy ID.");
            ids.add(row.id);
            return { entry: legacyEntry(row.sound, `legacy:import-${auditionId(row.id).slice(2).toLowerCase()}`), editable: true };
          });
          this.write({ entries, favorites: [] });
        }
      }
      this.read();
    } catch (error) { this.warning = `Saved library could not be read: ${(error as Error).message} Original data is retained.`; }
  }
  get available() { return this.store !== null; }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private read(): Shelf {
    const raw = this.store?.getItem(SOUND_LIBRARY_KEY);
    if (!raw) return structuredClone(this.memory);
    const data = parseJsonFile(raw) as Shelf;
    if (!data || !Array.isArray(data.entries) || !Array.isArray(data.favorites) || data.entries.length > SOUND_LIBRARY_LIMIT || data.favorites.length > 512) throw new Error("Invalid saved library.");
    const ids = new Set(this.factory.map(e => e.id));
    const blind = new Set(this.factory.map(e => auditionId(e.id)));
    const entries = data.entries.map(row => {
      const entry = parseEntry(row.entry);
      if (typeof row.editable !== "boolean" || ids.has(entry.id) || blind.has(auditionId(entry.id))) throw new Error("Duplicate or invalid saved ID.");
      ids.add(entry.id); blind.add(auditionId(entry.id));
      return { entry, editable: row.editable };
    });
    if (!data.favorites.every(id => typeof id === "string" && ids.has(id))) throw new Error("Unknown favorite ID.");
    return { entries, favorites: [...new Set(data.favorites)] };
  }
  private write(next: Shelf) {
    if (next.entries.length > SOUND_LIBRARY_LIMIT) throw new Error("The shelf holds 192 saved sounds. Export a pack before removing sounds.");
    // Write first: quota failures cannot create a phantom save or partial pack.
    const serialized = JSON.stringify(next);
    parseJsonFile(serialized); // Same byte bound on writes and subsequent reads.
    if (this.store) this.store.setItem(SOUND_LIBRARY_KEY, serialized);
    this.memory = next;
    this.version++;
    this.listeners.forEach(fn => fn());
  }
  list(): SavedEntry[] {
    try { return [...this.factory.map(entry => ({ entry: structuredClone(entry), editable: false })), ...this.read().entries]; }
    catch { return this.factory.map(entry => ({ entry: structuredClone(entry), editable: false })); }
  }
  favorites(): string[] { try { return this.read().favorites; } catch { return []; } }
  favorite(id: string) {
    const next = this.read();
    if (!this.list().some(r => r.entry.id === id)) throw new Error("Unknown sound.");
    next.favorites = next.favorites.includes(id) ? next.favorites.filter(x => x !== id) : [...next.favorites, id];
    this.write(next);
  }
  saveNew(sound: SoundDocument, metadata: PresetMetadata): PresetEntry {
    const next = this.read();
    const entry = parseEntry({ id: `local:sound-${crypto.randomUUID()}`, version: 1, sound, metadata });
    next.entries.push({ entry, editable: true }); this.write(next); return entry;
  }
  duplicate(id: string): PresetEntry {
    const source = this.list().find(r => r.entry.id === id)?.entry;
    if (!source) throw new Error("Unknown sound.");
    return this.saveNew(source.sound, { ...source.metadata, name: `${source.metadata.name.slice(0, 70)} copy`, contributor: "Local author", provenance: `Derived from ${source.id} v${source.version}; ${source.metadata.contributor}`, validation: "authored-unheard", measurements: [], listeningNotes: [] });
  }
  rename(id: string, name: string) {
    const next = this.read();
    const row = next.entries.find(r => r.entry.id === id);
    if (!row?.editable) throw new Error("Duplicate an original before renaming it.");
    row.entry = parseEntry({ ...row.entry, version: row.entry.version + 1, metadata: { ...row.entry.metadata, name } });
    this.write(next);
  }
  remove(id: string) {
    const next = this.read();
    next.entries = next.entries.filter(r => r.entry.id !== id);
    next.favorites = next.favorites.filter(x => x !== id); this.write(next);
  }
  importPack(input: unknown): PresetEntry[] {
    const pack = parsePack(input);
    const next = this.read();
    const existing = this.list().map(r => r.entry);
    for (const entry of pack.entries) {
      if (existing.some(e => e.id === entry.id || auditionId(e.id) === auditionId(entry.id))) throw new Error(`ID ${entry.id} is already installed. No sounds were imported.`);
    }
    next.entries.push(...pack.entries.map(entry => ({ entry, editable: false })));
    this.write(next); return pack.entries;
  }
  exportEntry(id: string): PresetPack {
    const entry = this.list().find(r => r.entry.id === id)?.entry;
    if (!entry) throw new Error("Unknown sound.");
    return { format: "phosphor-preset-pack", version: 1, namespace: id.split(":")[0], entries: [entry] };
  }
}
