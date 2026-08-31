import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MOTION_SECONDS,
  MOTION_SIZE,
  clampMotionPath,
  clampMotionValue,
  complementMotionPath,
  createDefaultMotionPath,
  motionFrameAtTime,
  sampleMotionPath,
} from "./motion.ts";

describe("MOTION path", () => {
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

  it("converts elapsed time to position and completes once", () => {
    const path = createDefaultMotionPath();
    assert.deepEqual(motionFrameAtTime(path, -1), {
      progress: 0,
      position: 0,
      complete: false,
    });
    assert.deepEqual(motionFrameAtTime(path, MOTION_SECONDS / 2), {
      progress: 0.5,
      position: 0.5,
      complete: false,
    });
    assert.deepEqual(motionFrameAtTime(path, MOTION_SECONDS), {
      progress: 1,
      position: 1,
      complete: true,
    });
    assert.deepEqual(motionFrameAtTime(path, MOTION_SECONDS * 2), {
      progress: 1,
      position: 1,
      complete: true,
    });
  });

  it("complements the A/B coordinate system", () => {
    assert.deepEqual(complementMotionPath([0, 0.25, 1]), [1, 0.75, 0]);
    assert.deepEqual(complementMotionPath([-1, 2]), [1, 0]);
  });
});
