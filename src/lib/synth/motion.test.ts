import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampMotionEndpoint, mapMotionRoute } from "./motion-routing.ts";
import {
  DEFAULT_MOTION_TIMING,
  MOTION_SIZE,
  MOTION_PRESETS,
  generateMotionPreset,
  beatDurationSeconds,
  clampMotionBpm,
  clampMotionPath,
  clampMotionValue,
  complementMotionPath,
  createDefaultMotionPath,
  motionDurationSeconds,
  motionFrameAtTime,
  sampleMotionPath,
  type MotionTiming,
} from "./motion.ts";

describe("MOTION path", () => {
  it("maps reversed effect ranges and enforces the Drive ceiling at dispatch", () => {
    assert.equal(mapMotionRoute("chorusMix", { enabled: true, from: 0.8, to: 0.2 }, 0), 0.8);
    assert.ok(Math.abs(mapMotionRoute("chorusMix", { enabled: true, from: 0.8, to: 0.2 }, 1) - 0.2) < 1e-12);
    for (const value of [-1, 0, 0.25, 0.5, 1, 2, NaN]) {
      const result = mapMotionRoute("driveAmount", { enabled: true, from: -4, to: 4 }, value);
      assert.ok(result >= 0 && result <= 0.25);
    }
    assert.equal(clampMotionEndpoint("driveAmount", 0.8), 0.25);
    assert.equal(clampMotionEndpoint("spaceMix", NaN), 0);
  });
  it("offers bounded loop-continuous shapes with a deliberately narrower Drift", () => {
    for (const { id } of MOTION_PRESETS) {
      const path = generateMotionPreset(id);
      assert.equal(path.length, MOTION_SIZE);
      assert.ok(path.every(x => Number.isFinite(x) && x >= 0 && x <= 1));
      if (id !== "sweep") assert.equal(path[0], path.at(-1));
      if (id === "drift") {
        assert.ok(Math.min(...path) >= 0.3);
        assert.ok(Math.max(...path) <= 0.7);
      }
    }
    const pulse = generateMotionPreset("double-pulse");
    assert.ok(sampleMotionPath(pulse, 0.25) > 0.999);
    assert.ok(sampleMotionPath(pulse, 0.5) < 0.001);
    assert.ok(sampleMotionPath(pulse, 0.75) > 0.999);
  });

  it("defaults to an exact A to B line", () => {
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
      position: 0.2,
      complete: false,
    });
    assert.deepEqual(motionFrameAtTime(path, 1), {
      progress: 0.5,
      position: 0.7,
      complete: false,
    });
    assert.deepEqual(motionFrameAtTime(path, 2), {
      progress: 1,
      position: 0.4,
      complete: true,
    });
    assert.deepEqual(motionFrameAtTime(path, 4), {
      progress: 1,
      position: 0.4,
      complete: true,
    });
  });

  it("wraps Loop to the authored beginning", () => {
    const path = createDefaultMotionPath();
    const timing: MotionTiming = { bpm: 120, beats: 4, mode: "loop" };
    assert.deepEqual(motionFrameAtTime(path, 0, timing), {
      progress: 0,
      position: 0,
      complete: false,
    });
    assert.deepEqual(motionFrameAtTime(path, 1, timing), {
      progress: 0.5,
      position: 0.5,
      complete: false,
    });
    assert.deepEqual(motionFrameAtTime(path, 2, timing), {
      progress: 0,
      position: 0,
      complete: false,
    });
    assert.deepEqual(motionFrameAtTime(path, 2.5, timing), {
      progress: 0.25,
      position: 0.25,
      complete: false,
    });
  });

  it("maps Ping-pong forward then backward over one complete cycle", () => {
    const path = createDefaultMotionPath();
    const timing: MotionTiming = { bpm: 120, beats: 4, mode: "ping-pong" };
    assert.equal(motionFrameAtTime(path, 0, timing).position, 0);
    assert.equal(motionFrameAtTime(path, 0.5, timing).position, 0.5);
    assert.equal(motionFrameAtTime(path, 1, timing).position, 1);
    assert.equal(motionFrameAtTime(path, 1.5, timing).position, 0.5);
    assert.equal(motionFrameAtTime(path, 2, timing).position, 0);
    assert.equal(motionFrameAtTime(path, 2.5, timing).position, 0.5);
  });

  it("completes only One-shot mode", () => {
    const path = createDefaultMotionPath();
    const atBoundary = (mode: MotionTiming["mode"]) =>
      motionFrameAtTime(path, 2, { ...DEFAULT_MOTION_TIMING, mode });
    assert.equal(atBoundary("one-shot").complete, true);
    assert.equal(atBoundary("loop").complete, false);
    assert.equal(atBoundary("ping-pong").complete, false);
  });

  it("complements the A/B coordinate system", () => {
    assert.deepEqual(complementMotionPath([0, 0.25, 1]), [1, 0.75, 0]);
    assert.deepEqual(complementMotionPath([-1, 2]), [1, 0]);
  });
});
