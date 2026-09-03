import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MOTION_ROUTES,
  DEFAULT_MOTION_TIMING,
  MOTION_SIZE,
  beatDurationSeconds,
  clampMotionBpm,
  clampMotionPath,
  clampMotionValue,
  cloneMotionRoutes,
  createMotionRunSnapshot,
  createDefaultMotionPath,
  hasPlayableMotionRoute,
  mapMotionValue,
  motionCycleMorph,
  motionDurationSeconds,
  motionFrameAtTime,
  sampleMotionPath,
  type MotionTiming,
} from "./motion.ts";

describe("MOTION path", () => {
  it("defaults to an exact normalized ramp", () => {
    const path = createDefaultMotionPath();
    assert.equal(path.length, MOTION_SIZE);
    assert.equal(path[0], 0);
    assert.equal(path[path.length - 1], 1);
    for (let i = 0; i < path.length; i++) {
      assert.equal(path[i], i / (path.length - 1));
    }
  });

  it("clamps scalar and path values", () => {
    assert.equal(clampMotionValue(-2), 0);
    assert.equal(clampMotionValue(0.4), 0.4);
    assert.equal(clampMotionValue(3), 1);
    assert.equal(clampMotionValue(Number.NaN), 0);
    assert.deepEqual(clampMotionPath([-1, 0.25, 2]), [0, 0.25, 1]);
  });

  it("interpolates the curve and preserves exact endpoints", () => {
    const path = [0.2, 1, 0.4];
    assert.equal(sampleMotionPath(path, 0), 0.2);
    assert.equal(sampleMotionPath(path, 1), 0.4);
    assert.ok(Math.abs(sampleMotionPath(path, 0.25) - 0.6) < 1e-12);
    assert.ok(Math.abs(sampleMotionPath(path, 0.75) - 0.7) < 1e-12);
  });

  it("converts BPM and beat lengths to seconds", () => {
    assert.equal(beatDurationSeconds(120), 0.5);
    assert.equal(motionDurationSeconds(120, 1), 0.5);
    assert.equal(motionDurationSeconds(120, 2), 1);
    assert.equal(motionDurationSeconds(120, 4), 2);
    assert.equal(motionDurationSeconds(120, 8), 4);
    assert.equal(clampMotionBpm(20), 40);
    assert.equal(clampMotionBpm(300), 240);
  });

  it("preserves exact one-shot endpoints", () => {
    const path = [0.2, 0.7, 0.4];
    assert.deepEqual(motionFrameAtTime(path, -1), {
      progress: 0,
      value: 0.2,
      complete: false,
    });
    assert.deepEqual(motionFrameAtTime(path, 1), {
      progress: 0.5,
      value: 0.7,
      complete: false,
    });
    assert.deepEqual(motionFrameAtTime(path, 2), {
      progress: 1,
      value: 0.4,
      complete: true,
    });
    assert.deepEqual(motionFrameAtTime(path, 4), {
      progress: 1,
      value: 0.4,
      complete: true,
    });
  });

  it("wraps Loop to the authored beginning", () => {
    const path = createDefaultMotionPath();
    const timing: MotionTiming = { bpm: 120, beats: 4, mode: "loop" };
    assert.deepEqual(motionFrameAtTime(path, 0, timing), {
      progress: 0,
      value: 0,
      complete: false,
    });
    assert.deepEqual(motionFrameAtTime(path, 1, timing), {
      progress: 0.5,
      value: 0.5,
      complete: false,
    });
    assert.deepEqual(motionFrameAtTime(path, 2, timing), {
      progress: 0,
      value: 0,
      complete: false,
    });
    assert.deepEqual(motionFrameAtTime(path, 2.5, timing), {
      progress: 0.25,
      value: 0.25,
      complete: false,
    });
  });

  it("maps Ping-pong forward then backward over one complete cycle", () => {
    const path = createDefaultMotionPath();
    const timing: MotionTiming = { bpm: 120, beats: 4, mode: "ping-pong" };
    assert.equal(motionFrameAtTime(path, 0, timing).value, 0);
    assert.equal(motionFrameAtTime(path, 0.5, timing).value, 0.5);
    assert.equal(motionFrameAtTime(path, 1, timing).value, 1);
    assert.equal(motionFrameAtTime(path, 1.5, timing).value, 0.5);
    assert.equal(motionFrameAtTime(path, 2, timing).value, 0);
    assert.equal(motionFrameAtTime(path, 2.5, timing).value, 0.5);
  });

  it("completes only One-shot mode", () => {
    const path = createDefaultMotionPath();
    const atBoundary = (mode: MotionTiming["mode"]) =>
      motionFrameAtTime(path, 2, { ...DEFAULT_MOTION_TIMING, mode });
    assert.equal(atBoundary("one-shot").complete, true);
    assert.equal(atBoundary("loop").complete, false);
    assert.equal(atBoundary("ping-pong").complete, false);
  });

  it("defines the exact conservative route defaults", () => {
    assert.deepEqual(DEFAULT_MOTION_ROUTES, {
      cycle: { enabled: true, inverted: false },
      driveAmount: { enabled: false, from: 0, to: 0.25 },
      chorusMix: { enabled: false, from: 0, to: 0.35 },
      spaceMix: { enabled: false, from: 0.38, to: 0.7 },
    });
  });

  it("maps numeric routes exactly at source endpoints and midpoint", () => {
    assert.equal(mapMotionValue(0, 0.1, 0.7), 0.1);
    assert.equal(mapMotionValue(0.5, 0.1, 0.7), 0.4);
    assert.equal(mapMotionValue(1, 0.1, 0.7), 0.7);
  });

  it("supports reversed route endpoints", () => {
    assert.equal(mapMotionValue(0, 0.7, 0.1), 0.7);
    assert.ok(Math.abs(mapMotionValue(0.5, 0.7, 0.1) - 0.4) < 1e-12);
    assert.equal(mapMotionValue(1, 0.7, 0.1), 0.1);
  });

  it("keeps Cycle inversion separate from the shared source", () => {
    assert.equal(motionCycleMorph(0.2, false), 0.2);
    assert.equal(motionCycleMorph(0.2, true), 0.8);
  });

  it("requires an available enabled destination", () => {
    assert.equal(hasPlayableMotionRoute(DEFAULT_MOTION_ROUTES, false), false);
    assert.equal(hasPlayableMotionRoute(DEFAULT_MOTION_ROUTES, true), true);
    const effectsOnly = {
      ...cloneMotionRoutes(DEFAULT_MOTION_ROUTES),
      cycle: { ...DEFAULT_MOTION_ROUTES.cycle, enabled: false },
      chorusMix: { ...DEFAULT_MOTION_ROUTES.chorusMix, enabled: true },
    };
    assert.equal(hasPlayableMotionRoute(effectsOnly, false), true);
  });

  it("snapshots path, timing, and route configuration independently", () => {
    const path = [0.2, 0.8];
    const timing: { bpm: number; beats: 8; mode: "loop" } = {
      bpm: 90,
      beats: 8,
      mode: "loop",
    };
    const routes = {
      ...cloneMotionRoutes(DEFAULT_MOTION_ROUTES),
      driveAmount: { ...DEFAULT_MOTION_ROUTES.driveAmount, enabled: true },
    };
    const run = createMotionRunSnapshot(path, timing, routes, false);

    path[0] = 1;
    timing.bpm = 240;
    routes.driveAmount.to = 1;

    assert.deepEqual(run.path, [0.2, 0.8]);
    assert.deepEqual(run.timing, { bpm: 90, beats: 8, mode: "loop" });
    assert.deepEqual(run.routes.driveAmount, {
      enabled: true,
      from: 0,
      to: 0.25,
    });
  });
});
