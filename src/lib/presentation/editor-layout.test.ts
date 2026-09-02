import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { editorPlotInsets } from "./editor-layout.ts";

describe("editor plot layout", () => {
  it("preserves the established insets when the canvas has room", () => {
    assert.deepEqual(editorPlotInsets(900, 400), { x: 44, y: 40 });
  });

  it("gives a short mobile canvas useful vertical drawing room", () => {
    const compact = editorPlotInsets(320, 128);
    assert.equal(compact.y, 32);
    assert.ok(128 - compact.y * 2 >= 64);

    const veryShort = editorPlotInsets(320, 80);
    assert.equal(veryShort.y, 16);
    assert.equal(80 - veryShort.y * 2, 48);
  });

  it("never produces negative or inverted plot geometry", () => {
    const tiny = editorPlotInsets(60, 40);
    assert.ok(tiny.x >= 0);
    assert.ok(tiny.y >= 0);
    assert.ok(tiny.x * 2 <= 60);
    assert.ok(tiny.y * 2 <= 40);
  });
});
