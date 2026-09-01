import assert from "node:assert/strict";
import test from "node:test";
import {
  CHORUS_MAX_MS,
  CHORUS_MIN_MS,
  chorusDelayMs,
  chorusPosition,
  phaseShiftCurve,
} from "./chorus.ts";

test("chorus maps the authored position to the honest delay range", () => {
  assert.equal(chorusDelayMs(-1), CHORUS_MIN_MS);
  assert.equal(chorusDelayMs(1), CHORUS_MAX_MS);
  assert.equal(chorusDelayMs(0), (CHORUS_MIN_MS + CHORUS_MAX_MS) / 2);
  assert.equal(chorusPosition(CHORUS_MIN_MS), -1);
  assert.equal(chorusPosition(CHORUS_MAX_MS), 1);
});

test("stereo derivation is deterministic and half a cycle", () => {
  assert.deepEqual(phaseShiftCurve([0, 1, 2, 3]), [2, 3, 0, 1]);
  assert.deepEqual(phaseShiftCurve([0, 1, 2, 3], -0.5), [2, 3, 0, 1]);
});
