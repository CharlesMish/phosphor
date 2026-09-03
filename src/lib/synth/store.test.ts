import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  DEFAULT_MOTION_ROUTES,
  DEFAULT_MOTION_BEATS,
  DEFAULT_MOTION_BPM,
  DEFAULT_MOTION_MODE,
  cloneMotionRoutes,
  createDefaultMotionPath,
  motionFrameAtTime,
  type MotionRouteId,
} from "./motion.ts";
import { generateSpaceContour } from "./space.ts";
import { generateDrivePreset } from "./drive.ts";
import { generateChorusPreset } from "./chorus.ts";
import { useSynthStore } from "./store.ts";
import { cycleMorphSamples, synth } from "./engine.ts";
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
      motionValue: initialState.motionValue,
      motionRunId: 0,
      motionRun: null,
      motionBpm: DEFAULT_MOTION_BPM,
      motionBeats: DEFAULT_MOTION_BEATS,
      motionMode: DEFAULT_MOTION_MODE,
      motionRoutes: cloneMotionRoutes(DEFAULT_MOTION_ROUTES),
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

function assertArraysNear(actual: number[], expected: number[], epsilon = 1e-12) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index++) {
    assert.ok(
      Math.abs((actual[index] ?? 0) - (expected[index] ?? 0)) < epsilon,
      `sample ${index} differs: ${actual[index]} versus ${expected[index]}`,
    );
  }
}

function setOnlyMotionRoute(route: MotionRouteId) {
  useSynthStore.setState({
    motionRoutes: {
      cycle: {
        ...DEFAULT_MOTION_ROUTES.cycle,
        enabled: route === "cycle",
      },
      driveAmount: {
        ...DEFAULT_MOTION_ROUTES.driveAmount,
        enabled: route === "driveAmount",
      },
      chorusMix: {
        ...DEFAULT_MOTION_ROUTES.chorusMix,
        enabled: route === "chorusMix",
      },
      spaceMix: {
        ...DEFAULT_MOTION_ROUTES.spaceMix,
        enabled: route === "spaceMix",
      },
    },
  });
}

describe("MOTION store authority", () => {
  beforeEach(resetStore);

  it("starts optional effects with conservative audition defaults", () => {
    const state = useSynthStore.getState();
    assert.equal(state.chorusMix, 0);
    assert.equal(state.driveSafe, true);
    assert.equal(state.driveAmount, 0.25);
  });

  it("does not start playback when Cycle is the only route and A/B are unavailable", () => {
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

  it("keeps the source drawable without A/B while leaving unavailable Cycle untouched", () => {
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
      assert.equal(state.motionValue, 0.8);
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
    assert.equal(state.motionValue, path[0]);
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
    assert.equal(state.motionValue, path[path.length - 1]);
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
    const runId = startMotion();

    const driveBefore = generateDrivePreset("identity");
    const driveAfter = generateDrivePreset("hard");
    useSynthStore.getState().setLiveDrive(driveAfter);
    useSynthStore.getState().finishDriveGesture(driveBefore, driveAfter);
    useSynthStore.getState().applyDrivePreset("soft");
    useSynthStore.getState().setDriveAmount(0.2);
    assert.equal(useSynthStore.getState().motionPlaying, true);
    useSynthStore.getState().setDriveSafe(false);
    assert.equal(useSynthStore.getState().motionPlaying, true);
    useSynthStore.getState().setDomain("drive");
    useSynthStore.getState().undo();
    useSynthStore.getState().redo();
    assert.equal(useSynthStore.getState().motionPlaying, true);
    assert.equal(useSynthStore.getState().motionRunId, runId);

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
    assert.equal(after.motionValue, before.motionValue);
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
    assert.equal(after.motionValue, before.motionValue);
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
    assert.equal(state.motionValue, state.motionPath[0]);
    assert.equal(state.morph, state.motionPath[0]);
  });
});

describe("MOTION routing v1", () => {
  beforeEach(resetStore);

  it("keeps Cycle-only routing on the shared phase-coherent morph output", () => {
    const { slotA, slotB } = armMorph();
    const value = 0.37;
    const expected = cycleMorphSamples(slotA, slotB, value);

    useSynthStore.getState().auditionMotion(value, true);
    const state = useSynthStore.getState();
    assert.equal(state.motionValue, value);
    assert.equal(state.morph, value);
    assert.deepEqual(state.samples, expected);
    assert.deepEqual(state.motionRoutes, DEFAULT_MOTION_ROUTES);
  });

  it("makes manual Morph and Motion Cycle agree at the same position", () => {
    armMorph();
    useSynthStore.getState().setMorph(0.35, true);
    const manual = useSynthStore.getState();
    const manualSamples = manual.samples.slice();

    manual.auditionMotion(0.35, true);
    const motion = useSynthStore.getState();
    assert.equal(motion.morph, manual.morph);
    assert.deepEqual(motion.samples, manualSamples);
  });

  it("does not create Cycle history when re-engaging an unchanged endpoint", () => {
    const { slotA } = armMorph();
    useSynthStore.setState({
      samples: slotA.slice(),
      morph: 0,
      morphLive: false,
      past: [],
      future: [],
    });

    useSynthStore.getState().setMorph(0, true);
    assert.equal(useSynthStore.getState().past.length, 0);
  });

  it("plays without A/B when any numeric destination is enabled", () => {
    for (const route of ["driveAmount", "chorusMix", "spaceMix"] as const) {
      resetStore();
      setOnlyMotionRoute(route);
      const runId = startMotion();
      const state = useSynthStore.getState();
      assert.equal(state.motionRunId, runId);
      assert.equal(state.motionRun?.cycleAvailable, false);
      assert.equal(state.motionRun?.routes[route].enabled, true);
    }
  });

  it("does not play when every destination is unavailable or disabled", () => {
    useSynthStore.setState({
      motionRoutes: {
        cycle: { enabled: false, inverted: false },
        driveAmount: { enabled: false, from: 0, to: 0.25 },
        chorusMix: { enabled: false, from: 0, to: 0.35 },
        spaceMix: { enabled: false, from: 0.38, to: 0.7 },
      },
    });
    const before = useSynthStore.getState().motionRunId;
    useSynthStore.getState().playMotion();
    assert.equal(useSynthStore.getState().motionPlaying, false);
    assert.equal(useSynthStore.getState().motionRunId, before);
  });

  it("maps all numeric destinations exactly at source 0, 0.5, and 1", () => {
    useSynthStore.getState().setDriveSafe(false);
    useSynthStore.setState({
      motionRoutes: {
        cycle: { enabled: false, inverted: false },
        driveAmount: { enabled: true, from: 0.1, to: 0.7 },
        chorusMix: { enabled: true, from: 0.2, to: 0.8 },
        spaceMix: { enabled: true, from: 0.3, to: 0.9 },
      },
    });

    for (const [source, expected] of [
      [0, [0.1, 0.2, 0.3]],
      [0.5, [0.4, 0.5, 0.6]],
      [1, [0.7, 0.8, 0.9]],
    ] as const) {
      useSynthStore.getState().auditionMotion(source, true);
      const state = useSynthStore.getState();
      assert.equal(state.motionValue, source);
      assert.ok(Math.abs(state.driveAmount - expected[0]) < 1e-12);
      assert.ok(Math.abs(state.chorusMix - expected[1]) < 1e-12);
      assert.ok(Math.abs(state.spaceMix - expected[2]) < 1e-12);
    }
  });

  it("applies descending endpoint mappings", () => {
    useSynthStore.getState().setDriveSafe(false);
    useSynthStore.setState({
      motionRoutes: {
        ...cloneMotionRoutes(DEFAULT_MOTION_ROUTES),
        cycle: { enabled: false, inverted: false },
        driveAmount: { enabled: true, from: 0.7, to: 0.1 },
      },
    });

    useSynthStore.getState().auditionMotion(0.25);
    assert.ok(Math.abs(useSynthStore.getState().driveAmount - 0.55) < 1e-12);
  });

  it("keeps Motion-routed DRIVE Amount inside the SAFE ceiling", () => {
    const authored = useSynthStore.getState().driveCurve;
    const past = useSynthStore.getState().drivePast;
    const future = useSynthStore.getState().driveFuture;
    useSynthStore.setState({
      motionRoutes: {
        ...cloneMotionRoutes(DEFAULT_MOTION_ROUTES),
        cycle: { enabled: false, inverted: false },
        driveAmount: { enabled: true, from: 0, to: 1 },
      },
    });

    useSynthStore.getState().auditionMotion(1);
    assert.equal(useSynthStore.getState().driveAmount, 0.25);
    useSynthStore.getState().setDriveSafe(false);
    useSynthStore.getState().auditionMotion(1);
    const state = useSynthStore.getState();
    assert.equal(state.driveAmount, 1);
    assert.strictEqual(state.driveCurve, authored);
    assert.strictEqual(state.drivePast, past);
    assert.strictEqual(state.driveFuture, future);
  });

  it("routes CHORUS Mix without changing its Period or authored curve", () => {
    setOnlyMotionRoute("chorusMix");
    const before = useSynthStore.getState();
    const curve = before.chorusCurve;
    const past = before.chorusPast;
    const future = before.chorusFuture;

    before.auditionMotion(0.5);
    const after = useSynthStore.getState();
    assert.equal(after.chorusMix, 0.175);
    assert.equal(after.chorusPeriod, before.chorusPeriod);
    assert.strictEqual(after.chorusCurve, curve);
    assert.strictEqual(after.chorusPast, past);
    assert.strictEqual(after.chorusFuture, future);
  });

  it("routes SPACE Mix without changing or rebuilding its impulse response", () => {
    setOnlyMotionRoute("spaceMix");
    const before = useSynthStore.getState();
    const contour = before.spaceContour;
    const view = before.spaceView;
    const seed = before.spaceSeed;
    const seconds = before.spaceSeconds;
    const past = before.spacePast;
    const future = before.spaceFuture;
    const hasDrawn = before.spaceHasDrawn;
    const originalSetSpace = synth.setSpace;
    let rebuilds = 0;
    synth.setSpace = () => {
      rebuilds += 1;
    };

    try {
      before.auditionMotion(0.5);
    } finally {
      synth.setSpace = originalSetSpace;
    }

    const after = useSynthStore.getState();
    assert.equal(after.spaceMix, 0.54);
    assert.equal(rebuilds, 0);
    assert.strictEqual(after.spaceContour, contour);
    assert.strictEqual(after.spaceView, view);
    assert.equal(after.spaceSeed, seed);
    assert.equal(after.spaceSeconds, seconds);
    assert.equal(after.spaceHasDrawn, hasDrawn);
    assert.strictEqual(after.spacePast, past);
    assert.strictEqual(after.spaceFuture, future);
  });

  it("leaves every unrouted destination untouched", () => {
    setOnlyMotionRoute("chorusMix");
    useSynthStore.setState({ driveAmount: 0.12, spaceMix: 0.44 });
    useSynthStore.getState().auditionMotion(0.8);
    const state = useSynthStore.getState();
    assert.equal(state.driveAmount, 0.12);
    assert.equal(state.spaceMix, 0.44);
  });

  it("batches one source frame across every enabled destination", () => {
    useSynthStore.getState().setDriveSafe(false);
    useSynthStore.setState({
      motionRoutes: {
        cycle: { enabled: false, inverted: false },
        driveAmount: { enabled: true, from: 0, to: 0.4 },
        chorusMix: { enabled: true, from: 0.1, to: 0.5 },
        spaceMix: { enabled: true, from: 0.2, to: 0.8 },
      },
    });
    let storeFrames = 0;
    const unsubscribe = useSynthStore.subscribe(() => {
      storeFrames += 1;
    });
    useSynthStore.getState().auditionMotion(0.5);
    unsubscribe();

    const state = useSynthStore.getState();
    assert.equal(storeFrames, 1);
    assert.equal(state.motionValue, 0.5);
    assert.equal(state.driveAmount, 0.2);
    assert.ok(Math.abs(state.chorusMix - 0.3) < 1e-12);
    assert.equal(state.spaceMix, 0.5);
  });

  it("uses snapshotted path, timing, and routes for the whole run", () => {
    useSynthStore.getState().setDriveSafe(false);
    const path = createDefaultMotionPath();
    path[0] = 0.2;
    useSynthStore.setState({
      motionPath: path,
      motionBpm: 90,
      motionBeats: 8,
      motionMode: "loop",
      motionRoutes: {
        ...cloneMotionRoutes(DEFAULT_MOTION_ROUTES),
        cycle: { enabled: false, inverted: false },
        driveAmount: { enabled: true, from: 0.1, to: 0.5 },
      },
    });
    const runId = startMotion();
    const run = useSynthStore.getState().motionRun;
    assert.ok(run);

    path[0] = 1;
    useSynthStore.setState({
      motionPath: [1, 1],
      motionBpm: 240,
      motionBeats: 1,
      motionMode: "one-shot",
      motionRoutes: {
        ...cloneMotionRoutes(DEFAULT_MOTION_ROUTES),
        cycle: { enabled: false, inverted: false },
        driveAmount: { enabled: true, from: 0.8, to: 1 },
      },
    });
    useSynthStore.getState().setMotionPlaybackPosition(0.5, 0.5, false, runId);

    const state = useSynthStore.getState();
    assert.deepEqual(run.path[0], 0.2);
    assert.deepEqual(run.timing, { bpm: 90, beats: 8, mode: "loop" });
    assert.deepEqual(run.routes.driveAmount, {
      enabled: true,
      from: 0.1,
      to: 0.5,
    });
    assert.ok(Math.abs(state.driveAmount - 0.3) < 1e-12);
  });

  it("rejects stale runIds before they can change routed values", () => {
    setOnlyMotionRoute("chorusMix");
    const staleRunId = startMotion();
    useSynthStore.getState().playMotion();
    const before = useSynthStore.getState();
    assert.notEqual(before.motionRunId, staleRunId);

    useSynthStore
      .getState()
      .setMotionPlaybackPosition(1, 0.8, false, staleRunId);
    const after = useSynthStore.getState();
    assert.equal(after.motionValue, before.motionValue);
    assert.equal(after.chorusMix, before.chorusMix);
  });

  it("retrigger immediately reapplies numeric routes at the path start", () => {
    useSynthStore.getState().setDriveSafe(false);
    setOnlyMotionRoute("driveAmount");
    const path = createDefaultMotionPath();
    path[0] = 0.4;
    useSynthStore.setState({ motionPath: path });
    const firstRunId = startMotion();
    useSynthStore
      .getState()
      .setMotionPlaybackPosition(0.9, 0.7, false, firstRunId);

    useSynthStore.getState().playMotion();
    const state = useSynthStore.getState();
    assert.ok(state.motionRunId > firstRunId);
    assert.equal(state.motionProgress, 0);
    assert.equal(state.motionValue, 0.4);
    assert.equal(state.driveAmount, 0.1);
  });

  it("Stop freezes the current source and routed state", () => {
    setOnlyMotionRoute("spaceMix");
    const runId = startMotion();
    useSynthStore.getState().setMotionPlaybackPosition(0.4, 0.3, false, runId);
    useSynthStore.getState().stopMotion();
    const frozen = useSynthStore.getState();

    useSynthStore.getState().setMotionPlaybackPosition(1, 0.9, false, runId);
    const after = useSynthStore.getState();
    assert.equal(after.motionValue, frozen.motionValue);
    assert.equal(after.motionProgress, frozen.motionProgress);
    assert.equal(after.spaceMix, frozen.spaceMix);
  });

  it("One-shot completion holds the final source and routed state", () => {
    setOnlyMotionRoute("chorusMix");
    const runId = startMotion();
    useSynthStore.getState().setMotionPlaybackPosition(1, 1, true, runId);
    const state = useSynthStore.getState();
    assert.equal(state.motionPlaying, false);
    assert.equal(state.motionValue, 1);
    assert.equal(state.motionProgress, 1);
    assert.equal(state.chorusMix, 0.35);
  });

  it("applies each Loop and Ping-pong frame to all routes from one source", () => {
    for (const mode of ["loop", "ping-pong"] as const) {
      resetStore();
      armMorph();
      useSynthStore.getState().setDriveSafe(false);
      useSynthStore.setState({
        motionMode: mode,
        motionRoutes: {
          cycle: { enabled: true, inverted: false },
          driveAmount: { enabled: true, from: 0, to: 0.4 },
          chorusMix: { enabled: true, from: 0.1, to: 0.5 },
          spaceMix: { enabled: true, from: 0.2, to: 0.8 },
        },
      });
      const runId = startMotion();
      const run = useSynthStore.getState().motionRun;
      assert.ok(run);
      const frame = motionFrameAtTime(run.path, 0.5, run.timing);
      useSynthStore
        .getState()
        .setMotionPlaybackPosition(frame.value, frame.progress, false, runId);
      const state = useSynthStore.getState();
      assert.equal(state.motionValue, frame.value);
      assert.equal(state.morph, frame.value);
      assert.ok(Math.abs(state.driveAmount - frame.value * 0.4) < 1e-12);
      assert.ok(Math.abs(state.chorusMix - (0.1 + frame.value * 0.4)) < 1e-12);
      assert.ok(Math.abs(state.spaceMix - (0.2 + frame.value * 0.6)) < 1e-12);
    }
  });

  it("manual edits to an actively routed numeric destination take authority", () => {
    const cases = [
      ["driveAmount", () => useSynthStore.getState().setDriveAmount(0.12), "driveAmount", 0.12],
      ["chorusMix", () => useSynthStore.getState().setChorusMix(0.44), "chorusMix", 0.44],
      ["spaceMix", () => useSynthStore.getState().setSpaceMix(0.62), "spaceMix", 0.62],
    ] as const;

    for (const [route, edit, key, expected] of cases) {
      resetStore();
      setOnlyMotionRoute(route);
      startMotion();
      edit();
      const state = useSynthStore.getState();
      assert.equal(state.motionPlaying, false);
      assert.equal(state[key], expected);
    }
  });

  it("manual edits to unrouted destinations leave Motion running", () => {
    setOnlyMotionRoute("driveAmount");
    startMotion();
    useSynthStore.getState().setChorusMix(0.4);
    useSynthStore.getState().setSpaceMix(0.6);
    useSynthStore.getState().setLiveContour(generateSpaceContour("long"));
    assert.equal(useSynthStore.getState().motionPlaying, true);
  });

  it("manual Cycle edits leave an effects-only Motion run active", () => {
    armMorph();
    setOnlyMotionRoute("driveAmount");
    startMotion();
    useSynthStore.getState().setMorph(0.6);
    assert.equal(useSynthStore.getState().motionPlaying, true);
    useSynthStore.getState().setLiveSamples(generatePreset("triangle"));
    assert.equal(useSynthStore.getState().motionPlaying, true);
  });

  it("does not add path history for route or timing configuration", () => {
    const past = [[0.2, 0.8]];
    const future = [[0.4, 0.6]];
    useSynthStore.setState({ motionPast: past, motionFuture: future });
    const state = useSynthStore.getState();
    state.setMotionRouteEnabled("driveAmount", true);
    useSynthStore.getState().setMotionRouteEndpoint("driveAmount", "from", 0.7);
    useSynthStore.getState().setMotionRouteEndpoint("driveAmount", "to", 0.1);
    useSynthStore.getState().setMotionBpm(96);
    useSynthStore.getState().setMotionBeats(8);
    useSynthStore.getState().setMotionMode("ping-pong");

    const after = useSynthStore.getState();
    assert.strictEqual(after.motionPast, past);
    assert.strictEqual(after.motionFuture, future);
  });

  it("locks timing and route configuration to the current run snapshot", () => {
    setOnlyMotionRoute("driveAmount");
    startMotion();
    const before = useSynthStore.getState();
    before.setMotionRouteEnabled("chorusMix", true);
    useSynthStore.getState().setMotionRouteEndpoint("driveAmount", "to", 0.9);
    useSynthStore.getState().setMotionBpm(200);
    useSynthStore.getState().setMotionBeats(1);
    useSynthStore.getState().setMotionMode("loop");
    const after = useSynthStore.getState();
    assert.strictEqual(after.motionRoutes, before.motionRoutes);
    assert.equal(after.motionBpm, before.motionBpm);
    assert.equal(after.motionBeats, before.motionBeats);
    assert.equal(after.motionMode, before.motionMode);
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

describe("DRIVE audition parameters", () => {
  beforeEach(resetStore);

  it("caps SAFE Amount and leaves the current Amount unchanged when SAFE is disabled", () => {
    let state = useSynthStore.getState();
    assert.equal(state.driveSafe, true);
    assert.equal(state.driveAmount, 0.25);

    state.setDriveAmount(1);
    state = useSynthStore.getState();
    assert.equal(state.driveAmount, 0.25);

    state.setDriveSafe(false);
    state = useSynthStore.getState();
    assert.equal(state.driveSafe, false);
    assert.equal(state.driveAmount, 0.25);

    state.setDriveAmount(0.8);
    assert.equal(useSynthStore.getState().driveAmount, 0.8);
    useSynthStore.getState().setDriveSafe(true);
    state = useSynthStore.getState();
    assert.equal(state.driveSafe, true);
    assert.equal(state.driveAmount, 0.25);
  });

  it("does not put Amount or SAFE in any authored history", () => {
    useSynthStore.getState().setDomain("drive");
    useSynthStore.getState().applyDrivePreset("hard");
    useSynthStore.getState().undo();

    const before = useSynthStore.getState();
    assert.equal(before.drivePreset, "identity");
    assert.equal(before.driveFuture.length, 1);
    const authored = before.driveCurve;
    const hasDrawn = before.driveHasDrawn;
    const histories = {
      cyclePast: before.past,
      cycleFuture: before.future,
      motionPast: before.motionPast,
      motionFuture: before.motionFuture,
      drivePast: before.drivePast,
      driveFuture: before.driveFuture,
      chorusPast: before.chorusPast,
      chorusFuture: before.chorusFuture,
      spacePast: before.spacePast,
      spaceFuture: before.spaceFuture,
    };

    before.setDriveSafe(false);
    useSynthStore.getState().setDriveAmount(0.8);
    useSynthStore.getState().setDriveSafe(true);
    useSynthStore.getState().setDriveSafe(false);
    useSynthStore.getState().setDriveAmount(0.8);

    let state = useSynthStore.getState();
    assert.strictEqual(state.driveCurve, authored);
    assert.equal(state.drivePreset, "identity");
    assert.equal(state.driveHasDrawn, hasDrawn);
    assert.strictEqual(state.past, histories.cyclePast);
    assert.strictEqual(state.future, histories.cycleFuture);
    assert.strictEqual(state.motionPast, histories.motionPast);
    assert.strictEqual(state.motionFuture, histories.motionFuture);
    assert.strictEqual(state.drivePast, histories.drivePast);
    assert.strictEqual(state.driveFuture, histories.driveFuture);
    assert.strictEqual(state.chorusPast, histories.chorusPast);
    assert.strictEqual(state.chorusFuture, histories.chorusFuture);
    assert.strictEqual(state.spacePast, histories.spacePast);
    assert.strictEqual(state.spaceFuture, histories.spaceFuture);

    state.redo();
    state = useSynthStore.getState();
    assert.equal(state.drivePreset, "hard");
    assert.deepEqual(state.driveCurve, generateDrivePreset("hard"));
    assert.equal(state.driveSafe, false);
    assert.equal(state.driveAmount, 0.8);
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

describe("MOTION store history and A/B Swap", () => {
  beforeEach(resetStore);

  it("preserves Cycle sound by inverting only the Cycle route interpretation", () => {
    const slotA = generatePreset("sine");
    const slotB = generatePreset("square");
    const motionPath = [0.3, 0.25, 1];
    const motionPast = [[0.1, 0.4, 0.8]];
    const motionFuture = [[0.2, 0.6, 0.9]];
    useSynthStore.setState({
      slotA,
      slotB,
      motionPath,
      motionPast,
      motionFuture,
      motionRoutes: {
        cycle: { enabled: true, inverted: false },
        driveAmount: { enabled: true, from: 0, to: 0.25 },
        chorusMix: { enabled: true, from: 0, to: 0.35 },
        spaceMix: { enabled: true, from: 0.38, to: 0.7 },
      },
    });
    startMotion();
    const before = useSynthStore.getState();
    const soundingSamples = before.samples;
    const driveOutput = before.driveAmount;
    const chorusOutput = before.chorusMix;
    const spaceOutput = before.spaceMix;
    const driveRoute = before.motionRoutes.driveAmount;
    const chorusRoute = before.motionRoutes.chorusMix;
    const spaceRoute = before.motionRoutes.spaceMix;

    useSynthStore.getState().swapSlots();
    let state = useSynthStore.getState();
    assert.deepEqual(state.slotA, slotB);
    assert.deepEqual(state.slotB, slotA);
    assert.notStrictEqual(state.slotA, slotB);
    assert.notStrictEqual(state.slotB, slotA);
    assert.equal(state.morph, 0.7);
    assert.equal(state.motionRoutes.cycle.inverted, true);
    assert.strictEqual(state.motionPath, motionPath);
    assert.strictEqual(state.motionPast, motionPast);
    assert.strictEqual(state.motionFuture, motionFuture);
    assert.strictEqual(state.motionRoutes.driveAmount, driveRoute);
    assert.strictEqual(state.motionRoutes.chorusMix, chorusRoute);
    assert.strictEqual(state.motionRoutes.spaceMix, spaceRoute);
    assert.strictEqual(state.samples, soundingSamples);
    assert.equal(state.motionPlaying, false);

    state.auditionMotion(0.3, true);
    state = useSynthStore.getState();
    assert.equal(state.motionValue, 0.3);
    assert.equal(state.morph, 0.7);
    assertArraysNear(state.samples, soundingSamples);
    assert.equal(state.driveAmount, driveOutput);
    assert.equal(state.chorusMix, chorusOutput);
    assert.equal(state.spaceMix, spaceOutput);
  });

  it("does not stop or reverse non-Cycle routing during an A/B Swap", () => {
    const { slotA, slotB } = armMorph();
    setOnlyMotionRoute("spaceMix");
    const runId = startMotion();
    useSynthStore.getState().setMotionPlaybackPosition(0.6, 0.4, false, runId);
    const before = useSynthStore.getState();

    before.swapSlots();
    const after = useSynthStore.getState();
    assert.deepEqual(after.slotA, slotB);
    assert.deepEqual(after.slotB, slotA);
    assert.equal(after.motionPlaying, true);
    assert.equal(after.motionRunId, runId);
    assert.equal(after.motionValue, before.motionValue);
    assert.equal(after.spaceMix, before.spaceMix);
    assert.deepEqual(after.motionRun?.routes.spaceMix, before.motionRun?.routes.spaceMix);
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
