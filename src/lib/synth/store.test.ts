import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  DEFAULT_MOTION_BEATS,
  DEFAULT_MOTION_BPM,
  DEFAULT_MOTION_MODE,
  createDefaultMotionPath,
} from "./motion.ts";
import { generateSpaceContour } from "./space.ts";
import { generateDrivePreset } from "./drive.ts";
import { generateChorusPreset } from "./chorus.ts";
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
      motionBpm: DEFAULT_MOTION_BPM,
      motionBeats: DEFAULT_MOTION_BEATS,
      motionMode: DEFAULT_MOTION_MODE,
      motionPast: [],
      motionFuture: [],
      driveCurve: initialState.driveCurve.slice(),
      drivePast: [],
      driveFuture: [],
      chorusCurve: initialState.chorusCurve.slice(),
      chorusPast: [],
      chorusFuture: [],
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

  it("does not start playback without both A and B", () => {
    const wave = generatePreset("sine");
    const slotCases = [
      { slotA: null, slotB: null },
      { slotA: wave.slice(), slotB: null },
      { slotA: null, slotB: wave.slice() },
    ];

    for (const slots of slotCases) {
      resetStore();
      useSynthStore.setState(slots);
      const before = useSynthStore.getState();
      useSynthStore.getState().playMotion();
      const after = useSynthStore.getState();
      assert.equal(after.motionPlaying, false);
      assert.equal(after.motionRunId, before.motionRunId);
    }
  });

  it("does not audition or change sound without both A and B", () => {
    const wave = generatePreset("sine");
    const slotCases = [
      { slotA: null, slotB: null },
      { slotA: wave.slice(), slotB: null },
      { slotA: null, slotB: wave.slice() },
    ];

    for (const slots of slotCases) {
      resetStore();
      const samples = generatePreset("triangle");
      useSynthStore.setState({ ...slots, samples, morph: 0.23 });
      useSynthStore.getState().auditionMotion(0.8, true);
      const state = useSynthStore.getState();
      assert.equal(state.morph, 0.23);
      assert.strictEqual(state.samples, samples);
    }
  });

  it("starts playback at the exact first authored position", () => {
    armMorph();
    const path = createDefaultMotionPath();
    path[0] = 0.37;
    useSynthStore.setState({ motionPath: path, motionProgress: 0.8 });

    useSynthStore.getState().playMotion();
    const state = useSynthStore.getState();
    assert.equal(state.morph, path[0]);
    assert.equal(state.motionProgress, 0);
    assert.equal(state.motionPlaying, true);
  });

  it("applies the exact final position and stops on completion", () => {
    armMorph();
    const path = createDefaultMotionPath();
    path[path.length - 1] = 0.83;
    useSynthStore.setState({ motionPath: path });
    const runId = startMotion();

    useSynthStore
      .getState()
      .setMotionPlaybackPosition(path[path.length - 1]!, 1, true, runId);
    const state = useSynthStore.getState();
    assert.equal(state.morph, path[path.length - 1]);
    assert.equal(state.motionProgress, 1);
    assert.equal(state.motionPlaying, false);
  });

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

  it("stops playback when a CYCLE preset is applied", () => {
    armMorph();
    startMotion();
    useSynthStore.getState().applyPreset("saw");
    assert.equal(useSynthStore.getState().motionPlaying, false);
  });

  it("stops playback for CYCLE Undo and Redo", () => {
    armMorph();
    useSynthStore.setState({
      domain: "cycle",
      past: [generatePreset("triangle")],
      future: [],
    });
    startMotion();
    useSynthStore.getState().undo();
    assert.equal(useSynthStore.getState().motionPlaying, false);

    resetStore();
    armMorph();
    useSynthStore.setState({
      domain: "cycle",
      past: [],
      future: [generatePreset("saw")],
    });
    startMotion();
    useSynthStore.getState().redo();
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
    useSynthStore.getState().setSpaceLength(2.4);
    useSynthStore.getState().commitSpaceLength(2.4);
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
    for (const domain of ["cycle", "motion", "drive", "chorus", "space"] as const) {
      useSynthStore.getState().setDomain(domain);
      assert.equal(useSynthStore.getState().motionPlaying, true);
    }
  });

  it("allows DRIVE and CHORUS operations without stopping playback", () => {
    armMorph();
    startMotion();

    const driveBefore = generateDrivePreset("identity");
    const driveAfter = generateDrivePreset("hard");
    useSynthStore.getState().setLiveDrive(driveAfter);
    useSynthStore.getState().finishDriveGesture(driveBefore, driveAfter);
    useSynthStore.getState().applyDrivePreset("soft");
    useSynthStore.getState().setDomain("drive");
    useSynthStore.getState().undo();
    useSynthStore.getState().redo();
    assert.equal(useSynthStore.getState().motionPlaying, true);

    const chorusBefore = generateChorusPreset("sine");
    const chorusAfter = generateChorusPreset("triangle");
    useSynthStore.getState().setLiveChorus(chorusAfter);
    useSynthStore.getState().finishChorusGesture(chorusBefore, chorusAfter);
    useSynthStore.getState().applyChorusPreset("wild");
    useSynthStore.getState().setChorusPeriod(0.8);
    useSynthStore.getState().setChorusMix(0.5);
    useSynthStore.getState().setDomain("chorus");
    useSynthStore.getState().undo();
    useSynthStore.getState().redo();
    assert.equal(useSynthStore.getState().motionPlaying, true);
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

  it("restarts from the beginning with a new run id when retriggered", () => {
    armMorph();
    const first = startMotion();
    useSynthStore.getState().setMotionPlaybackPosition(0.7, 0.6, false, first);
    useSynthStore.getState().playMotion();
    const state = useSynthStore.getState();
    assert.ok(state.motionRunId > first);
    assert.equal(state.motionProgress, 0);
    assert.equal(state.morph, state.motionPath[0]);
  });
});

describe("editor history isolation", () => {
  beforeEach(resetStore);

  it("routes Undo and Redo only to the active CYCLE, MOTION, DRIVE, CHORUS, or SPACE stack", () => {
    const cycleBefore = initialState.samples.slice();
    const cycleAfter = generatePreset("triangle");
    useSynthStore.getState().setLiveSamples(cycleAfter);
    useSynthStore.getState().finishGesture(cycleBefore, cycleAfter);

    const motionBefore = createDefaultMotionPath();
    const motionAfter = motionBefore.slice();
    motionAfter[24] = 0.9;
    useSynthStore.getState().setLiveMotionPath(motionAfter);
    useSynthStore.getState().finishMotionGesture(motionBefore, motionAfter);

    const driveBefore = generateDrivePreset("identity");
    const driveAfter = generateDrivePreset("hard");
    useSynthStore.getState().setLiveDrive(driveAfter);
    useSynthStore.getState().finishDriveGesture(driveBefore, driveAfter);

    const chorusBefore = generateChorusPreset("sine");
    const chorusAfter = generateChorusPreset("triangle");
    useSynthStore.getState().setLiveChorus(chorusAfter);
    useSynthStore.getState().finishChorusGesture(chorusBefore, chorusAfter);

    const spaceBefore = generateSpaceContour("room");
    const spaceAfter = spaceBefore.slice();
    spaceAfter[48] = 0.8;
    useSynthStore.getState().setLiveContour(spaceAfter);
    useSynthStore.getState().finishSpaceGesture(spaceBefore, spaceAfter);
    useSynthStore.getState().setSpaceLength(2.7);
    useSynthStore.getState().commitSpaceLength(2.7);

    const historySizes = () => {
      const state = useSynthStore.getState();
      return {
        cycle: [state.past.length, state.future.length],
        motion: [state.motionPast.length, state.motionFuture.length],
        drive: [state.drivePast.length, state.driveFuture.length],
        chorus: [state.chorusPast.length, state.chorusFuture.length],
        space: [state.spacePast.length, state.spaceFuture.length],
      };
    };
    const domains = ["cycle", "motion", "drive", "chorus", "space"] as const;
    type Domain = (typeof domains)[number];
    const expected: Record<Domain, number[]> = {
      cycle: [1, 0],
      motion: [1, 0],
      drive: [1, 0],
      chorus: [1, 0],
      space: [1, 0],
    };
    assert.deepEqual(historySizes(), expected);

    for (const domain of domains) {
      useSynthStore.getState().setDomain(domain);
      useSynthStore.getState().undo();
      expected[domain] = [0, 1];
      assert.deepEqual(historySizes(), expected);
    }
    assert.equal(useSynthStore.getState().spaceSeconds, 2.7);

    for (const domain of domains) {
      useSynthStore.getState().setDomain(domain);
      useSynthStore.getState().redo();
      expected[domain] = [1, 0];
      assert.deepEqual(historySizes(), expected);
    }
    assert.equal(useSynthStore.getState().spaceSeconds, 2.7);
  });
});

describe("CHORUS store history", () => {
  beforeEach(resetStore);

  it("does not add history or clear redo when the active preset is reapplied", () => {
    useSynthStore.getState().setDomain("chorus");
    useSynthStore.getState().applyChorusPreset("triangle");
    useSynthStore.getState().undo();

    let state = useSynthStore.getState();
    assert.equal(state.chorusPreset, "sine");
    assert.equal(state.chorusPast.length, 0);
    assert.equal(state.chorusFuture.length, 1);

    useSynthStore.getState().applyChorusPreset("sine");
    state = useSynthStore.getState();
    assert.equal(state.chorusPreset, "sine");
    assert.equal(state.chorusPast.length, 0);
    assert.equal(state.chorusFuture.length, 1);
  });

  it("keeps redo available after a no-op drawing gesture", () => {
    const sine = generateChorusPreset("sine");
    useSynthStore.getState().setDomain("chorus");
    useSynthStore.getState().applyChorusPreset("triangle");
    useSynthStore.getState().undo();

    useSynthStore.getState().finishChorusGesture(sine, sine.slice());
    let state = useSynthStore.getState();
    assert.equal(state.chorusPreset, "sine");
    assert.equal(state.chorusPast.length, 0);
    assert.equal(state.chorusFuture.length, 1);

    useSynthStore.getState().redo();
    state = useSynthStore.getState();
    assert.equal(state.chorusPreset, "triangle");
    assert.deepEqual(state.chorusCurve, generateChorusPreset("triangle"));
  });

  it("restores preset and custom identities through Undo and Redo", () => {
    useSynthStore.getState().setDomain("chorus");
    useSynthStore.getState().applyChorusPreset("triangle");
    useSynthStore.getState().undo();
    assert.equal(useSynthStore.getState().chorusPreset, "sine");

    useSynthStore.getState().redo();
    assert.equal(useSynthStore.getState().chorusPreset, "triangle");

    const triangle = generateChorusPreset("triangle");
    const custom = triangle.slice();
    custom[17] = 0.123;
    useSynthStore.getState().setLiveChorus(custom);
    useSynthStore.getState().finishChorusGesture(triangle, custom);
    useSynthStore.getState().applyChorusPreset("wild");

    useSynthStore.getState().undo();
    assert.equal(useSynthStore.getState().chorusPreset, "custom");
    assert.deepEqual(useSynthStore.getState().chorusCurve, custom);

    useSynthStore.getState().redo();
    assert.equal(useSynthStore.getState().chorusPreset, "wild");
    assert.deepEqual(useSynthStore.getState().chorusCurve, generateChorusPreset("wild"));
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
