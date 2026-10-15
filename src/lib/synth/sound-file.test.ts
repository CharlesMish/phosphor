import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { DEFAULT_SOUND_SOURCE, useSynthStore } from "./store.ts";
import {
  SOUND_FORMAT,
  SoundFileError,
  parseSound,
  parseSoundText,
  snapshotSound,
  soundFileName,
  type SoundSnapshot,
} from "./sound-file.ts";
import {
  CURRENT_SOUND_KEY,
  SOUND_LIBRARY_KEY,
  SOUND_LIBRARY_LIMIT,
  SoundLibrary,
  type KeyValueStore,
} from "./sound-library.ts";
import { generatePreset } from "./waveform.ts";
import { generateDrivePreset } from "./drive.ts";
import { generateMotionPreset } from "./motion.ts";
import { cycleMorphSamples } from "./engine.ts";

const initialState = useSynthStore.getInitialState();

function resetStore() {
  useSynthStore.setState({ ...initialState }, true);
}

class MemoryStore implements KeyValueStore {
  map = new Map<string, string>();
  quota = Infinity;
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (value.length > this.quota) {
      const error = new Error("full");
      error.name = "QuotaExceededError";
      throw error;
    }
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

/** Edit every sound-defining field away from the defaults. */
function editEverything() {
  const s = useSynthStore.getState();
  s.applyPreset("saw");
  s.captureA();
  s.applyPreset("square");
  s.captureB();
  s.setMorph(0.37);
  s.setParam("attack", 0.12);
  s.setParam("release", 1.4);
  s.setParam("cutoff", 0.61);
  s.setParam("volume", 0.5);
  s.applyDrivePreset("asym");
  s.setDriveSafe(false);
  s.setDriveAmount(0.8);
  s.applyChorusPreset("rise");
  s.setChorusPeriod(2.75);
  s.setChorusMix(0.4);
  s.applySpacePreset("metal");
  s.scatterSpace();
  s.setSpaceMix(0.2);
  s.commitSpaceLength(2.4);
  s.applyMotionPreset("pulse-332");
  s.setMotionBpm(96);
  s.setMotionBeats(8);
  s.setMotionMode("ping-pong");
  s.setMotionRouteEnabled("chorusMix", true);
  s.setMotionRouteEndpoint("chorusMix", "to", 0.6);
}

function roundTrip(sound: SoundSnapshot): SoundSnapshot {
  return parseSoundText(JSON.stringify(sound));
}

describe("sound file", () => {
  beforeEach(resetStore);

  it("captures and restores every sound-defining field exactly", () => {
    editEverything();
    const before = useSynthStore.getState();
    const saved = roundTrip(snapshotSound(before, "  Night   glass "));
    assert.equal(saved.format, SOUND_FORMAT);
    assert.equal(saved.name, "Night glass");

    resetStore();
    useSynthStore.getState().loadSound(saved);
    const after = useSynthStore.getState();
    for (const key of [
      "samples", "preset", "slotA", "slotB", "morph", "morphLive", "attack", "release", "cutoff", "volume",
      "driveCurve", "drivePreset", "driveAmount", "driveSafe", "chorusCurve", "chorusPreset", "chorusPeriod",
      "chorusMix", "spaceContour", "spaceSeed", "spacePreset", "spaceMetal", "spaceMix", "spaceSeconds",
      "motionPath", "motionBpm", "motionBeats", "motionMode", "motionRoutes", "spaceView",
    ] as const) {
      assert.deepEqual(after[key], before[key], key);
    }
    assert.equal(after.morphLive, true);
    assert.deepEqual(after.samples, cycleMorphSamples(after.slotA!, after.slotB!, 0.37));
  });

  it("starts fresh undo histories and stops Motion when loading", () => {
    editEverything();
    const sound = snapshotSound(useSynthStore.getState(), "x");
    useSynthStore.setState({ motionPlaying: true });
    useSynthStore.getState().loadSound(sound);
    const s = useSynthStore.getState();
    assert.equal(s.motionPlaying, false);
    for (const key of ["past", "future", "motionPast", "motionFuture", "drivePast", "driveFuture",
      "chorusPast", "chorusFuture", "spacePast", "spaceFuture"] as const) {
      assert.deepEqual(s[key], [], key);
    }
  });

  it("New sound matches a fresh visit", () => {
    editEverything();
    useSynthStore.getState().loadSound(snapshotSound(DEFAULT_SOUND_SOURCE, "fresh"));
    const s = useSynthStore.getState();
    assert.deepEqual(s.samples, generatePreset("sine"));
    assert.deepEqual(s.driveCurve, generateDrivePreset("identity"));
    assert.equal(s.slotA, null);
    assert.equal(s.morphLive, false);
    assert.deepEqual(s.motionRoutes, initialState.motionRoutes);
    assert.equal(s.spaceSeed, initialState.spaceSeed);
  });

  it("refuses damaged or foreign files instead of clamping them", () => {
    const good = snapshotSound(useSynthStore.getState(), "ok");
    const cases: [string, (s: any) => void][] = [
      ["format", (s) => { s.format = "something-else"; }],
      ["version", (s) => { s.version = 2; }],
      ["short cycle", (s) => { s.cycle.samples = s.cycle.samples.slice(1); }],
      ["NaN sample", (s) => { s.cycle.samples[3] = null; }],
      ["loud sample", (s) => { s.cycle.samples[3] = 1.5; }],
      ["morph without B", (s) => { s.cycle.morphLive = true; s.cycle.slotA = s.cycle.samples; }],
      ["attack", (s) => { s.voice.attack = 5; }],
      ["safe drive above cap", (s) => { s.drive.safe = true; s.drive.amount = 0.9; }],
      ["preset", (s) => { s.chorus.preset = "laser"; }],
      ["space seed", (s) => { s.space.seed = -1; }],
      ["space length", (s) => { s.space.seconds = 9; }],
      ["bpm", (s) => { s.motion.bpm = 500; }],
      ["beats", (s) => { s.motion.beats = 3; }],
      ["route", (s) => { s.motion.routes.driveAmount.to = 0.9; }],
      ["contour", (s) => { s.space.contour[0] = -0.1; }],
    ];
    for (const [label, damage] of cases) {
      const copy = structuredClone(good) as any;
      damage(copy);
      assert.throws(() => parseSound(copy), SoundFileError, label);
    }
    assert.throws(() => parseSoundText("{not json"), SoundFileError);
  });

  it("names files safely", () => {
    assert.equal(soundFileName("Glass / keys: 2!"), "Glass-keys-2.phosphor.json");
    assert.equal(soundFileName(""), "Untitled-sound.phosphor.json");
  });

  it("keeps the 3:3:2 Motion path exactly", () => {
    useSynthStore.getState().applyMotionPreset("pulse-332");
    const sound = roundTrip(snapshotSound(useSynthStore.getState(), "m"));
    assert.deepEqual(sound.motion.path, generateMotionPreset("pulse-332"));
  });
});

describe("sound library", () => {
  beforeEach(resetStore);

  it("autosaves the current sound and ignores a damaged autosave", () => {
    const store = new MemoryStore();
    const library = new SoundLibrary(store);
    assert.equal(library.readCurrent(), null);
    editEverything();
    const sound = snapshotSound(useSynthStore.getState(), "current");
    library.writeCurrent(sound);
    assert.deepEqual(library.readCurrent(), sound);
    store.setItem(CURRENT_SOUND_KEY, "{\"format\":\"phosphor-sound\"}");
    assert.equal(library.readCurrent(), null);
    assert.equal(store.getItem(CURRENT_SOUND_KEY), null, "damaged autosave is removed");
  });

  it("saves by name, replaces same-named sounds, lists newest first and deletes", () => {
    const library = new SoundLibrary(new MemoryStore());
    let changes = 0;
    library.subscribe(() => changes++);
    const base = snapshotSound(useSynthStore.getState(), "One", new Date("2026-10-01T00:00:00Z"));
    const one = library.save(base);
    library.save({ ...base, name: "Two", savedAt: "2026-10-02T00:00:00.000Z" });
    const again = library.save({ ...base, name: "one", savedAt: "2026-10-03T00:00:00.000Z" });
    assert.equal(again.id, one.id, "same name (any case) updates the entry");
    assert.deepEqual(library.list().entries.map((e) => e.sound.name), ["one", "Two"]);
    library.remove(one.id);
    assert.deepEqual(library.list().entries.map((e) => e.sound.name), ["Two"]);
    assert.equal(changes, 4);
    assert.equal(library.version, 4);
  });

  it("skips unreadable entries and reports them", () => {
    const store = new MemoryStore();
    const library = new SoundLibrary(store);
    const sound = snapshotSound(useSynthStore.getState(), "good");
    store.setItem(SOUND_LIBRARY_KEY, JSON.stringify([{ id: "a", sound }, { id: "b", sound: { format: "x" } }, 7]));
    const read = library.list();
    assert.equal(read.entries.length, 1);
    assert.equal(read.skipped, 2);
  });

  it("explains a full browser store and a full library", () => {
    const store = new MemoryStore();
    const library = new SoundLibrary(store);
    const sound = snapshotSound(useSynthStore.getState(), "big");
    store.quota = 10;
    assert.throws(() => library.save(sound), /storage is full/);
    store.quota = Infinity;
    for (let i = 0; i < SOUND_LIBRARY_LIMIT; i++) library.save({ ...sound, name: `s${i}` });
    assert.throws(() => library.save({ ...sound, name: "one more" }), /holds 48 sounds/);
    library.save({ ...sound, name: "s3" });
  });

  it("works without storage by refusing writes clearly", () => {
    const library = new SoundLibrary(null);
    assert.equal(library.available, false);
    assert.equal(library.readCurrent(), null);
    assert.throws(() => library.save(snapshotSound(useSynthStore.getState(), "x")), /no storage/);
  });
});
