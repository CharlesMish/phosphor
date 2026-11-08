import starterData from "./starter.pack.json" with { type: "json" };
import favoritesData from "./favorites.pack.json" with { type: "json" };
import { parseEntry, parsePack, type PresetEntry } from "@/lib/synth/preset-pack";

/**
 * Built-in sounds: the listening favourites. `starter.pack.json` stays as the
 * reviewed foundation bank (tests and the contributor kit use it); only its
 * Open reed line ships here. Every other contributed sound is still importable
 * from its own pack, because these copies use their own `favorites:` IDs.
 */
export const OPEN_REED_ID = "foundation:lead-01";

/**
 * Built-ins that were removed. A browser may still have them starred; those
 * stars are dropped on load instead of making the saved shelf unreadable.
 */
export const RETIRED_FACTORY_IDS: readonly string[] = [
  "foundation:bass-01",
  "foundation:keys-01",
  "foundation:pad-01",
];

const LISTENED = "Charlie: one of the favourites in the blind listening round (November 2026).";

export function factoryEntries(): PresetEntry[] {
  const reed = parsePack(starterData).entries.find((entry) => entry.id === OPEN_REED_ID);
  if (!reed) throw new Error("The starter pack no longer contains Open reed line.");
  const reviewed = parseEntry({
    ...reed,
    version: reed.version + 1,
    metadata: { ...reed.metadata, validation: "listening-reviewed", listeningNotes: [LISTENED] },
  });
  const favorites = parsePack(favoritesData).entries;
  // Role order: keys, then the leads (Open reed line first), pad, short notes, wildcards.
  const [organ, ...rest] = favorites;
  return organ ? [organ, reviewed, ...rest] : [reviewed];
}
