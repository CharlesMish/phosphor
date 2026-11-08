import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { OPEN_REED_ID, RETIRED_FACTORY_IDS, factoryEntries } from "../../presets/factory.ts";
import { SOUND_LIBRARY_KEY, SoundLibrary, type KeyValueStore } from "./sound-library.ts";
import { parsePack, type PresetEntry } from "./preset-pack.ts";

function memory(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

it("ships the nine listening favourites as protected built-ins", () => {
  const entries = factoryEntries();
  assert.deepEqual(entries.map((e) => e.metadata.name), [
    "Drawbar Organ", "Open reed line", "Reed Lead", "Chip Pulse", "String Machine",
    "Mallet Echo", "Glass Arp", "Vowel Steps", "Speak Toy",
  ]);
  assert.equal(new Set(entries.map((e) => e.id)).size, 9);
  assert.ok(entries.every((e) => e.metadata.validation === "listening-reviewed" && e.metadata.listeningNotes.length === 1));
  const reed = entries.find((e) => e.id === OPEN_REED_ID)!;
  assert.equal(reed.metadata.contributor, "Astra foundation");
  assert.equal(reed.version, 2);
  assert.ok(entries.filter((e) => e.id !== OPEN_REED_ID).every((e) => e.id.startsWith("favorites:")));
  const shelf = new SoundLibrary(memory(), entries, RETIRED_FACTORY_IDS);
  assert.equal(shelf.list().length, 9);
  assert.ok(entries.every((e) => shelf.isFactory(e.id)));
});

it("built-in copies keep each original sound exactly", () => {
  const starter = parsePack(JSON.parse(readFileSync(new URL("../../presets/starter.pack.json", import.meta.url), "utf8")));
  const reed = factoryEntries().find((e) => e.id === OPEN_REED_ID)!;
  assert.deepEqual(reed.sound, starter.entries.find((e) => e.id === OPEN_REED_ID)!.sound);
});

it("stars on retired built-ins are dropped instead of locking the saved shelf", () => {
  const store = memory({ [SOUND_LIBRARY_KEY]: JSON.stringify({ entries: [], favorites: ["foundation:keys-01", "foundation:lead-01"] }) });
  const shelf = new SoundLibrary(store, factoryEntries(), RETIRED_FACTORY_IDS);
  assert.deepEqual(shelf.favorites(), ["foundation:lead-01"]);
  shelf.favorite("favorites:glass-arp");
  assert.deepEqual(JSON.parse(store.data.get(SOUND_LIBRARY_KEY)!).favorites, ["foundation:lead-01", "favorites:glass-arp"]);
  // Unknown IDs that were never built in are still treated as damage.
  const broken = new SoundLibrary(memory({ [SOUND_LIBRARY_KEY]: JSON.stringify({ entries: [], favorites: ["nobody:sound"] }) }), factoryEntries(), RETIRED_FACTORY_IDS);
  assert.deepEqual(broken.favorites(), []);
});

it("the original contributor packs still import beside the built-in copies", () => {
  const shelf = new SoundLibrary(memory(), factoryEntries(), RETIRED_FACTORY_IDS);
  const copy = factoryEntries().find((e) => e.id === "favorites:drawbar-organ")!;
  const original: PresetEntry = { ...structuredClone(copy), id: "claude-r1:drawbar-organ" };
  const imported = shelf.importPack({ format: "phosphor-preset-pack", version: 1, namespace: "claude-r1", entries: [original] });
  assert.equal(imported.length, 1);
  assert.equal(shelf.list().length, 10);
});
