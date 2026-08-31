import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createDefaultMotionPath } from "./motion.ts";
import { generateSpaceContour } from "./space.ts";
import { useSynthStore } from "./store.ts";
import { generatePreset } from "./waveform.ts";

const initialState = useSynthStore.getInitialState();

function resetStore() {
  useSynthStore.setState(
    {
      ...initialState,
      samples: initialState.samples.slice(),
      slotA: null,
      slotB: null,
      past: [],
      future: [],
      motionPath: createDefaultMotionPath(),
      motionPlaying: false,
      motionProgress: 0,
      motionRunId: 0,
      motionPast: [],
      motionFuture: [],
      spaceContour: initialState.spaceContour.slice(),
      spaceView: initialState.spaceView.slice(),
      spacePast: [],
      spaceFuture: [],
    },
    true,
  );
}

function armMorph() {
  const slotA = generatePreset("sine");
  const slotB = generatePreset("square");
  useSynthStore.setState({
    slotA: slotA.slice(),
    slotB: slotB.slice(),
    samples: slotA.slice(),
    morph: 0,
    morphLive: true,
    past: [],
    future: [],
  });
  return { slotA, slotB };
}

function startMotion() {
  useSynthStore.getState().playMotion();
  const state = useSynthStore.getState();
  assert.equal(state.motionPlaying, true);
  return state.motionRunId;
}

describe("MOTION store authority", () => {
  beforeEach(resetStore);

  it("keeps drawing audition and playback out of CYCLE history", () => {
    armMorph();
    useSynthStore.setState({
      samples: generatePreset("wild"),
      morphLive: false,
      past: [],
    });

    useSynthStore.getState().auditionMotion(0.35);
    assert.equal(useSynthStore.getState().past.length, 0);

    useSynthStore.setState({
      samples: generatePreset("triangle"),
      morphLive: false,
      past: [],
    });
    const runId = startMotion();
    useSynthStore.getState().setMotionPlaybackPosition(0.7, 0.5, false, runId);
    assert.equal(useSynthStore.getState().past.length, 0);
  });

  it("adds exactly one MOTION history boundary for a completed gesture", () => {
    const before = createDefaultMotionPath();
    const after = before.slice();
    after[120] = 0.9;
    after[121] = 0.85;

    useSynthStore.getState().setLiveMotionPath(after);
    useSynthStore.getState().finishMotionGesture(before, after);

    const state = useSynthStore.getState();
    assert.equal(state.motionPast.length, 1);
    assert.deepEqual(state.motionPast[0], before);
    assert.equal(state.motionFuture.length, 0);
  });

  it("does not add MOTION history for a no-op gesture", () => {
    const path = createDefaultMotionPath();
    useSynthStore.getState().finishMotionGesture(path, path.slice());
    assert.equal(useSynthStore.getState().motionPast.length, 0);
  });

  it("stops playback when manual Morph moves", () => {
    armMorph();
    startMotion();
    useSynthStore.getState().setMorph(0.4);
    assert.equal(useSynthStore.getState().motionPlaying, false);
  });

  it("stops playback when CYCLE is edited", () => {
    armMorph();
    startMotion();
    useSynthStore.getState().setLiveSamples(generatePreset("triangle"));
    assert.equal(useSynthStore.getState().motionPlaying, false);
  });

  it("stops playback when A is captured", () => {
    armMorph();
    startMotion();
    useSynthStore.getState().captureA();
    assert.equal(useSynthStore.getState().motionPlaying, false);
  });

  it("stops playback when B is captured", () => {
    armMorph();
    startMotion();
    useSynthStore.getState().captureB();
    assert.equal(useSynthStore.getState().motionPlaying, false);
  });

  it("stops playback when MOTION is undone", () => {
    armMorph();
    const current = createDefaultMotionPath();
    const previous = current.map((value) => value * 0.5);
    useSynthStore.setState({ domain: "motion", motionPath: current, motionPast: [previous] });
    startMotion();

    useSynthStore.getState().undo();
    assert.equal(useSynthStore.getState().motionPlaying, false);
  });

  it("stops playback when MOTION is redone", () => {
    armMorph();
    const current = createDefaultMotionPath();
    const next = current.map((value) => 1 - value * 0.5);
    useSynthStore.setState({ domain: "motion", motionPath: current, motionFuture: [next] });
    startMotion();

    useSynthStore.getState().redo();
    assert.equal(useSynthStore.getState().motionPlaying, false);
  });

  it("allows SPACE operations without stopping playback", () => {
    armMorph();
    startMotion();
    const before = generateSpaceContour("room");
    const after = before.slice();
    after[40] = 0.75;

    useSynthStore.getState().setLiveContour(after);
    assert.equal(useSynthStore.getState().motionPlaying, true);
    useSynthStore.getState().finishSpaceGesture(before, after);
    assert.equal(useSynthStore.getState().motionPlaying, true);
    useSynthStore.getState().applySpacePreset("long");
    assert.equal(useSynthStore.getState().motionPlaying, true);
    useSynthStore.getState().scatterSpace();
    assert.equal(useSynthStore.getState().motionPlaying, true);
    useSynthStore.getState().setSpaceMix(0.6);
    assert.equal(useSynthStore.getState().motionPlaying, true);

    useSynthStore.getState().setDomain("space");
    useSynthStore.getState().undo();
    assert.equal(useSynthStore.getState().motionPlaying, true);
    useSynthStore.getState().redo();
    assert.equal(useSynthStore.getState().motionPlaying, true);
  });

  it("allows editor-domain changes without stopping playback", () => {
    armMorph();
    startMotion();
    for (const domain of ["motion", "space", "cycle"] as const) {
      useSynthStore.getState().setDomain(domain);
      assert.equal(useSynthStore.getState().motionPlaying, true);
    }
  });

  it("rejects a stale playback update from an old run", () => {
    armMorph();
    const oldRunId = startMotion();
    useSynthStore.getState().playMotion();
    const before = useSynthStore.getState();
    assert.notEqual(before.motionRunId, oldRunId);

    useSynthStore.getState().setMotionPlaybackPosition(0.8, 0.7, false, oldRunId);
    const after = useSynthStore.getState();
    assert.equal(after.morph, before.morph);
    assert.strictEqual(after.samples, before.samples);
  });

  it("rejects a playback tick after Stop", () => {
    armMorph();
    const runId = startMotion();
    useSynthStore.getState().stopMotion();
    const before = useSynthStore.getState();

    useSynthStore.getState().setMotionPlaybackPosition(0.8, 0.7, false, runId);
    const after = useSynthStore.getState();
    assert.equal(after.morph, before.morph);
    assert.strictEqual(after.samples, before.samples);
  });

  it("assigns a new run id when playback is retriggered", () => {
    armMorph();
    const first = startMotion();
    useSynthStore.getState().playMotion();
    assert.ok(useSynthStore.getState().motionRunId > first);
  });
});

describe("MOTION store history and A/B coordinates", () => {
  beforeEach(resetStore);

  it("transforms slots, morph, path, and histories on Swap without changing sound", () => {
    const slotA = [0, 0.25, 0.5];
    const slotB = [1, 0.75, 0.5];
    const soundingSamples = [0.2, -0.1, 0.4];
    const motionPath = [0, 0.25, 1];
    const motionPast = [[0.1, 0.4, 0.8]];
    const motionFuture = [[0.2, 0.6, 0.9]];
    useSynthStore.setState({
      slotA,
      slotB,
      samples: soundingSamples,
      morph: 0.3,
      motionPath,
      motionPast,
      motionFuture,
      motionPlaying: true,
    });

    useSynthStore.getState().swapSlots();
    const state = useSynthStore.getState();
    assert.deepEqual(state.slotA, slotB);
    assert.deepEqual(state.slotB, slotA);
    assert.notStrictEqual(state.slotA, slotB);
    assert.notStrictEqual(state.slotB, slotA);
    assert.equal(state.morph, 0.7);
    assert.deepEqual(state.motionPath, [1, 0.75, 0]);
    assert.deepEqual(
      state.motionPast,
      motionPast.map((path) => path.map((value) => 1 - value)),
    );
    assert.deepEqual(
      state.motionFuture,
      motionFuture.map((path) => path.map((value) => 1 - value)),
    );
    assert.equal(state.motionPast.length, motionPast.length);
    assert.equal(state.motionFuture.length, motionFuture.length);
    assert.strictEqual(state.samples, soundingSamples);
    assert.equal(state.motionPlaying, false);
  });

  it("keeps MOTION history snapshots independent from live path arrays", () => {
    const before = createDefaultMotionPath();
    const after = before.slice();
    after[10] = 0.95;
    useSynthStore.getState().finishMotionGesture(before, after);

    const state = useSynthStore.getState();
    const snapshot = state.motionPast[0];
    assert.ok(snapshot);
    assert.notStrictEqual(snapshot, before);
    assert.notStrictEqual(snapshot, state.motionPath);
    const expected = snapshot.slice();
    before[10] = 0.1;
    state.motionPath[10] = 0.2;
    assert.deepEqual(snapshot, expected);
  });

  it("Undo and Redo restore only the path without re-auditioning", () => {
    armMorph();
    const previousPath = createDefaultMotionPath().map((value) => value * 0.5);
    const currentPath = createDefaultMotionPath();
    const soundingSamples = generatePreset("triangle");
    useSynthStore.setState({
      domain: "motion",
      motionPath: currentPath,
      motionPast: [previousPath],
      morph: 0.42,
      samples: soundingSamples,
      motionPlaying: true,
    });

    useSynthStore.getState().undo();
    let state = useSynthStore.getState();
    assert.deepEqual(state.motionPath, previousPath);
    assert.equal(state.morph, 0.42);
    assert.strictEqual(state.samples, soundingSamples);
    assert.equal(state.motionPlaying, false);

    useSynthStore.getState().redo();
    state = useSynthStore.getState();
    assert.deepEqual(state.motionPath, currentPath);
    assert.equal(state.morph, 0.42);
    assert.strictEqual(state.samples, soundingSamples);
    assert.equal(state.motionPlaying, false);
  });
});
