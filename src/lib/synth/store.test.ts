import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  DEFAULT_MOTION_BEATS,
  DEFAULT_MOTION_BPM,
  DEFAULT_MOTION_MODE,
  createDefaultMotionPath,
  generateMotionPreset,
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

  it("makes a shape choice one undoable Motion edit without changing sound", (t) => {
    armMorph();
    useSynthStore.getState().setDomain("motion");
    const runId = startMotion();
    const before = useSynthStore.getState();
    const morph = t.mock.method(synth, "setCycleMorph", () => {});
    const wave = t.mock.method(synth, "setWaveform", () => {});
    before.applyMotionPreset("breathe");
    const after = useSynthStore.getState();
    assert.equal(after.motionPlaying, false);
    assert.equal(after.motionProgress, 0);
    assert.equal(after.motionPast.length, before.motionPast.length + 1);
    assert.deepEqual(after.motionPath, generateMotionPreset("breathe"));
    assert.strictEqual(after.samples, before.samples);
    assert.strictEqual(after.slotA, before.slotA);
    assert.strictEqual(after.slotB, before.slotB);
    assert.strictEqual(after.past, before.past);
    assert.equal(after.motionMode, before.motionMode);
    assert.equal(after.motionBpm, before.motionBpm);
    assert.equal(after.motionBeats, before.motionBeats);
    after.setMotionPlaybackPosition(0.9, 0.9, false, runId);
    assert.strictEqual(useSynthStore.getState().samples, before.samples);
    after.undo();
    assert.deepEqual(useSynthStore.getState().motionPath, before.motionPath);
    useSynthStore.getState().redo();
    assert.deepEqual(useSynthStore.getState().motionPath, generateMotionPreset("breathe"));
    assert.equal(morph.mock.callCount(), 0);
    assert.equal(wave.mock.callCount(), 0);
  });

  it("preserves redo when the same Motion shape is chosen again", () => {
    useSynthStore.getState().setDomain("motion");
    useSynthStore.getState().applyMotionPreset("breathe");
    useSynthStore.getState().applyMotionPreset("drift");
    useSynthStore.getState().undo();
    const before = useSynthStore.getState();
    before.applyMotionPreset("breathe");
    assert.strictEqual(useSynthStore.getState().motionPast, before.motionPast);
    assert.strictEqual(useSynthStore.getState().motionFuture, before.motionFuture);
  });

  it("sends manual, drawing, and playback morphs to the persistent voice path", (t) => {
    const { slotA, slotB } = armMorph();
    const morph = t.mock.method(synth, "setCycleMorph", () => {});
    const wave = t.mock.method(synth, "setWaveform", () => {});
    useSynthStore.getState().setMorph(0.2);
    useSynthStore.getState().auditionMotion(0.3);
    const runId = startMotion();
    useSynthStore.getState().setMotionPlaybackPosition(0.4, 0.4, false, runId);
    assert.equal(morph.mock.callCount(), 4);
    assert.equal(wave.mock.callCount(), 0);
    const args = morph.mock.calls.at(-1)!.arguments;
    assert.deepEqual(args.slice(0, 3), [slotA, slotB, 0.4]);
    assert.deepEqual(useSynthStore.getState().samples, cycleMorphSamples(slotA, slotB, 0.4));
  });

  it("does not amplify near-cancelling morph samples in the store", () => {
    const { slotA } = armMorph();
    const slotB = slotA.map(x => -x);
    useSynthStore.setState({ slotB });
    useSynthStore.getState().setMorph(0.49, true);
    const peak = Math.max(...useSynthStore.getState().samples.map(Math.abs));
    assert.ok(Math.abs(peak - 0.018) < 1e-12);
  });

  it("starts optional effects with conservative audition defaults", () => {
    const state = useSynthStore.getState();
    assert.equal(state.chorusMix, 0);
    assert.equal(state.driveSafe, true);
    assert.equal(state.driveAmount, 0.25);
  });

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

describe("MOTION store history and A/B coordinates", () => {
  beforeEach(resetStore);

  it("swaps Cycle coordinates without inverting the shared path or effect automation", () => {
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
    assert.strictEqual(state.motionPath, motionPath);
    assert.strictEqual(state.motionPast, motionPast);
    assert.strictEqual(state.motionFuture, motionFuture);
    assert.equal(state.motionRoutes.cycle.inverted, true);
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

describe("shared Motion destinations", () => {
  beforeEach(resetStore);

  function enableEffects() {
    const state = useSynthStore.getState();
    state.setMotionRouteEnabled("driveAmount", true);
    state.setMotionRouteEnabled("chorusMix", true);
    state.setMotionRouteEnabled("spaceMix", true);
  }

  it("plays all effect destinations without A/B and leaves all authored data intact", (t) => {
    enableEffects();
    useSynthStore.setState({ motionPath: [0.5, 1], driveSafe: false });
    const before = useSynthStore.getState();
    const cycle = t.mock.method(synth, "setCycleMorph", () => {});
    const wave = t.mock.method(synth, "setWaveform", () => {});
    const drive = t.mock.method(synth, "setDriveState", () => {});
    const chorus = t.mock.method(synth, "setChorusMix", () => {});
    const space = t.mock.method(synth, "setSpaceMix", () => {});
    const spaceBuffer = t.mock.method(synth, "setSpace", () => {});
    const lfo = t.mock.method(synth, "setChorusCurve", () => {});
    const run = startMotion();
    const first = useSynthStore.getState();
    assert.equal(first.driveAmount, 0.125);
    assert.equal(first.chorusMix, 0.175);
    assert.ok(Math.abs(first.spaceMix - 0.35) < 1e-12);
    assert.equal(drive.mock.calls.at(-1)!.arguments[1], 0.125);
    assert.equal(chorus.mock.calls.at(-1)!.arguments[0], 0.175);
    assert.ok(Math.abs(space.mock.calls.at(-1)!.arguments[0]! - 0.35) < 1e-12);
    first.setMotionPlaybackPosition(1, 1, true, run);
    const after = useSynthStore.getState();
    assert.equal(after.motionPlaying, false);
    assert.equal(after.driveAmount, 0.25);
    assert.equal(after.chorusMix, 0.35);
    assert.equal(after.spaceMix, 0.55);
    for (const key of ["samples", "driveCurve", "chorusCurve", "spaceContour", "past", "future", "motionPast", "drivePast", "chorusPast", "spacePast"] as const) {
      assert.strictEqual(after[key], before[key], key);
    }
    assert.equal(cycle.mock.callCount(), 0);
    assert.equal(wave.mock.callCount(), 0);
    assert.equal(spaceBuffer.mock.callCount(), 0);
    assert.equal(lfo.mock.callCount(), 0);
  });

  it("synchronizes Cycle with effects and keeps the direct morph slider independent", (t) => {
    armMorph();
    enableEffects();
    const cycle = t.mock.method(synth, "setCycleMorph", () => {});
    const drive = t.mock.method(synth, "setDriveState", () => {});
    const chorus = t.mock.method(synth, "setChorusMix", () => {});
    const space = t.mock.method(synth, "setSpaceMix", () => {});
    const run = startMotion();
    useSynthStore.getState().setMotionPlaybackPosition(0.8, 0.4, false, run);
    assert.equal(cycle.mock.calls.at(-1)!.arguments[2], 0.8);
    assert.equal(drive.mock.calls.at(-1)!.arguments[1], 0.2);
    assert.ok(Math.abs(chorus.mock.calls.at(-1)!.arguments[0]! - 0.28) < 1e-12);
    const before = useSynthStore.getState();
    const effectsCalls = [drive.mock.callCount(), chorus.mock.callCount(), space.mock.callCount()];
    before.setMorph(0.1);
    const after = useSynthStore.getState();
    assert.equal(after.motionPlaying, false);
    assert.equal(after.morph, 0.1);
    assert.equal(after.driveAmount, before.driveAmount);
    assert.deepEqual([drive.mock.callCount(), chorus.mock.callCount(), space.mock.callCount()], effectsCalls);
  });

  it("freezes effect amounts on Stop and rejects late updates", () => {
    enableEffects();
    const run = startMotion();
    useSynthStore.getState().setMotionPlaybackPosition(0.6, 0.2, false, run);
    const before = useSynthStore.getState();
    before.stopMotion();
    useSynthStore.getState().setMotionPlaybackPosition(1, 0.9, false, run);
    const after = useSynthStore.getState();
    assert.equal(after.driveAmount, before.driveAmount);
    assert.equal(after.chorusMix, before.chorusMix);
    assert.equal(after.spaceMix, before.spaceMix);
  });

  it("gives manual effect controls authority over an active route", () => {
    for (const route of ["driveAmount", "chorusMix", "spaceMix"] as const) {
      resetStore();
      useSynthStore.getState().setMotionRouteEnabled(route, true);
      const run = startMotion();
      const state = useSynthStore.getState();
      if (route === "driveAmount") state.setDriveAmount(0.19);
      else if (route === "chorusMix") state.setChorusMix(0.19);
      else state.setSpaceMix(0.19);
      assert.equal(useSynthStore.getState().motionPlaying, false);
      useSynthStore.getState().setMotionPlaybackPosition(1, 1, true, run);
      assert.equal(useSynthStore.getState()[route], 0.19);
    }
  });

  it("stops on routing edits, clamps Drive ranges, and rejects previous run ids", () => {
    enableEffects();
    const run = startMotion();
    useSynthStore.getState().setMotionRouteEndpoint("driveAmount", "to", 1);
    assert.equal(useSynthStore.getState().motionRoutes.driveAmount.to, 0.25);
    assert.equal(useSynthStore.getState().motionPlaying, false);
    const next = startMotion();
    assert.notEqual(run, next);
    const before = useSynthStore.getState();
    before.setMotionPlaybackPosition(1, 1, true, run);
    assert.strictEqual(useSynthStore.getState(), before);
    before.setMotionRouteEnabled("spaceMix", false);
    assert.equal(useSynthStore.getState().motionPlaying, false);
  });

  it("does not play or audition when every destination is disabled", () => {
    armMorph();
    useSynthStore.getState().setMotionRouteEnabled("cycle", false);
    const before = useSynthStore.getState();
    before.playMotion();
    before.auditionMotion(0.8);
    assert.strictEqual(useSynthStore.getState(), before);
  });

  it("auditions effects from drawing and skips repeated flat effect writes", (t) => {
    enableEffects();
    const drive = t.mock.method(synth, "setDriveState", () => {});
    const chorus = t.mock.method(synth, "setChorusMix", () => {});
    const space = t.mock.method(synth, "setSpaceMix", () => {});
    useSynthStore.getState().auditionMotion(0.4);
    useSynthStore.getState().auditionMotion(0.4);
    assert.equal(drive.mock.callCount(), 1);
    assert.equal(chorus.mock.callCount(), 1);
    assert.equal(space.mock.callCount(), 1);
  });

  it("keeps effect movement and Cycle sound equivalent across an A/B swap", (t) => {
    armMorph();
    enableEffects();
    t.mock.method(synth, "setCycleMorph", () => {});
    useSynthStore.getState().auditionMotion(0.3);
    const before = useSynthStore.getState();
    before.swapSlots();
    useSynthStore.getState().auditionMotion(0.3);
    const after = useSynthStore.getState();
    assert.equal(after.morph, 0.7);
    for (let i = 0; i < after.samples.length; i++) {
      assert.ok(Math.abs(after.samples[i]! - before.samples[i]!) < 1e-12);
    }
    assert.equal(after.driveAmount, before.driveAmount);
    assert.equal(after.chorusMix, before.chorusMix);
    assert.equal(after.spaceMix, before.spaceMix);
    assert.strictEqual(after.motionPath, before.motionPath);
  });
});
