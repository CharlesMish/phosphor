import assert from "node:assert/strict";
import { it } from "node:test";
import { noteLooper } from "./looper-runtime.ts";
import { createFactorySession, applySession, captureSession, restoreLocalSession, startSessionAutosave, writeLocalSession, type SessionStorageLike } from "./session-apply.ts";
import { parseSessionDocument, serializeSession, SESSION_STORAGE_KEY, type SessionDocument } from "./session-file.ts";
import { cycleMorphSamples } from "./engine.ts";
import { generateMotionPreset } from "./motion.ts";
import { useSynthStore } from "./store.ts";
import { generatePreset } from "./waveform.ts";

function memory(): SessionStorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

function nontrivial(): SessionDocument {
  const document = parseSessionDocument(JSON.parse(serializeSession(createFactorySession())));
  const slotA = generatePreset("sine");
  const slotB = generatePreset("saw");
  document.cycle.slotA = slotA;
  document.cycle.slotB = slotB;
  document.cycle.morph = 0.2;
  document.cycle.morphLive = true;
  document.cycle.preset = "custom";
  document.cycle.hasDrawn = true;
  document.cycle.samples = cycleMorphSamples(slotA, slotB, 0.2);
  document.motion.path = generateMotionPreset("log");
  document.motion.mode = "ping-pong";
  document.motion.bpm = 88;
  document.motion.beats = 8;
  document.motion.routes.cycle.inverted = true;
  document.motion.routes.chorusMix = { enabled: true, from: 0.7, to: 0 };
  document.noteLoop.bars = 4;
  document.noteLoop.events = [
    { id: 2, type: "on", midi: 48, beat: 0.5 },
    { id: 2, type: "off", midi: 48, beat: 1.5 },
    { id: 5, type: "on", midi: 55, beat: 8 },
  ];
  return parseSessionDocument(document);
}

it("a nontrivial loop with Motion round-trips through a clean session", () => {
  const session = nontrivial();
  useSynthStore.getState().applyPreset("square");
  useSynthStore.setState({ motionPlaying: true, past: [generatePreset("sine")] });
  applySession(session);
  const state = useSynthStore.getState();
  assert.equal(state.motionPlaying, false);
  assert.equal(state.past.length, 0);
  assert.equal(state.motionPast.length, 0);
  assert.equal(noteLooper.getSnapshot().state, "stopped");
  assert.equal(noteLooper.getSnapshot().progress, 0);
  assert.deepEqual(captureSession(), session);
  applySession(createFactorySession());
  assert.deepEqual(captureSession(), createFactorySession());
  applySession(session);
  assert.deepEqual(captureSession(), session);
});

it("a rejected file does not touch the session or the looper", () => {
  const session = nontrivial();
  applySession(session);
  const before = serializeSession(captureSession());
  let calls = 0;
  const stop = noteLooper.stop.bind(noteLooper);
  const load = noteLooper.loadTake.bind(noteLooper);
  noteLooper.stop = () => { calls += 1; stop(); };
  noteLooper.loadTake = (...args) => { calls += 1; load(...args); };
  try {
    const broken = JSON.parse(before) as { version: number };
    broken.version = 9;
    assert.throws(() => applySession(broken));
    assert.throws(() => applySession("{"));
    assert.equal(calls, 0);
  } finally {
    noteLooper.stop = stop;
    noteLooper.loadTake = load;
  }
  assert.equal(serializeSession(captureSession()), before);
  assert.equal(noteLooper.getSnapshot().state, "stopped");
  assert.deepEqual(noteLooper.getEvents(), session.noteLoop.events);
});

it("restores a local session and discards an unreadable one without applying it", () => {
  const session = nontrivial();
  const storage = memory();
  storage.setItem(SESSION_STORAGE_KEY, serializeSession(session));
  applySession(createFactorySession());
  assert.equal(restoreLocalSession(storage), "restored");
  assert.equal(noteLooper.getSnapshot().state, "stopped");
  assert.deepEqual(captureSession(), session);

  applySession(session);
  storage.setItem(SESSION_STORAGE_KEY, "{\"format\":\"phosphor-session\"}");
  assert.equal(restoreLocalSession(storage), "rejected");
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), null);
  assert.deepEqual(captureSession(), session);
});

it("does not write a partial recording over the saved session", async () => {
  const storage = memory();
  const session = nontrivial();
  applySession(session);
  writeLocalSession(storage);
  const saved = storage.getItem(SESSION_STORAGE_KEY);
  const snapshot = noteLooper.getSnapshot.bind(noteLooper);
  noteLooper.getSnapshot = () => ({ ...snapshot(), state: "recording" });
  try {
    writeLocalSession(storage);
    assert.equal(storage.getItem(SESSION_STORAGE_KEY), saved);
    const stop = startSessionAutosave(storage);
    useSynthStore.getState().setMotionBpm(100);
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(storage.getItem(SESSION_STORAGE_KEY), saved);
    stop();
  } finally {
    noteLooper.getSnapshot = snapshot;
  }
  writeLocalSession(storage);
  assert.equal(JSON.parse(storage.getItem(SESSION_STORAGE_KEY) ?? "{}").motion.bpm, 100);
  applySession(createFactorySession());
});
