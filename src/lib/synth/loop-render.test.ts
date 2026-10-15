import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeFloatWav, encodeFloatWav } from "./wav.ts";
import { motionLoopsWithTake, planRender, tailSeconds, takeNotes, RENDER_TAIL_MARGIN, SEAMLESS_GUARD_SECONDS } from "./loop-render.ts";
import { snapshotSound } from "./sound-file.ts";
import { DEFAULT_SOUND_SOURCE } from "./store.ts";
import type { NoteEvent } from "./note-looper.ts";

const sound = snapshotSound(DEFAULT_SOUND_SOURCE, "test");

describe("float WAV", () => {
  it("round-trips stereo samples exactly, including values above full scale", () => {
    const left = Float32Array.from([0, 0.5, -1, 1.25, -0.000001]);
    const right = Float32Array.from([1, -0.5, 0.25, -1.5, 0.3]);
    const bytes = encodeFloatWav([left, right], 48000, {
      title: "Glass", software: "Phosphor", comment: "odd", json: { a: 1, name: "é" },
    });
    const wav = decodeFloatWav(bytes);
    assert.equal(wav.sampleRate, 48000);
    assert.deepEqual(wav.channels, [left, right]);
    assert.deepEqual(wav.chunks, ["fmt ", "fact", "LIST", "phos", "data"]);
    assert.deepEqual(wav.info, { INAM: "Glass", ISFT: "Phosphor", ICMT: "odd" });
    assert.deepEqual(wav.json, { a: 1, name: "é" });
    const view = new DataView(bytes.buffer);
    assert.equal(view.getUint32(4, true), bytes.length - 8, "RIFF size");
    assert.equal(bytes.length % 2, 0, "chunks are word aligned");
  });

  it("refuses mismatched channels and odd sample rates", () => {
    assert.throws(() => encodeFloatWav([new Float32Array(2), new Float32Array(3)], 48000));
    assert.throws(() => encodeFloatWav([new Float32Array(2)], 44100.5));
    assert.throws(() => encodeFloatWav([], 48000));
  });
});

describe("take rendering plan", () => {
  it("pairs notes like the live looper and closes held notes at the window end", () => {
    const events: NoteEvent[] = [
      { id: 0, type: "on", midi: 60, beat: 0 },
      { id: 1, type: "on", midi: 64, beat: 1 },
      { id: 0, type: "off", midi: 60, beat: 0.5 },
      { id: 2, type: "on", midi: 67, beat: 2 },
      { id: 2, type: "off", midi: 67, beat: 2 },
    ];
    // 1 bar at 120 BPM: beats are 0.5 s; note 1 is held to the end (beat 4).
    assert.deepEqual(takeNotes(events, 1, 120), [
      { id: 0, midi: 60, start: 0, end: 0.25 },
      { id: 1, midi: 64, start: 0.5, end: 2 },
    ]);
  });

  it("plans a take with its tail, and a seamless loop with enough earlier passes", () => {
    const tail = sound.voice.release + sound.space.seconds + RENDER_TAIL_MARGIN;
    assert.equal(tailSeconds(sound), tail);
    const take = planRender(sound, 2, 120, "take");
    assert.equal(take.loopSeconds, 4);
    assert.equal(take.keepFromSeconds, 0);
    assert.equal(take.keepSeconds, 4 + tail);
    const loop = planRender(sound, 2, 120, "seamless");
    // One pass for the tail to wrap, the kept pass, then a little of the next.
    assert.deepEqual([loop.passes, loop.keepFromSeconds, loop.keepSeconds, loop.renderSeconds],
      [3, 4, 4, 8 + SEAMLESS_GUARD_SECONDS]);
    // One bar at 240 BPM is 1 s, shorter than the ~2 s tail: two passes to wrap it.
    const short = planRender(sound, 1, 240, "seamless");
    assert.deepEqual([short.passes, short.keepFromSeconds, short.keepSeconds], [4, 2, 1]);
  });

  it("drops the Space tail when Space is silent", () => {
    const dry = { ...sound, space: { ...sound.space, mix: 0 } };
    assert.equal(tailSeconds(dry), dry.voice.release + RENDER_TAIL_MARGIN);
  });

  it("knows when Motion repeats with the take", () => {
    const withMotion = (mode: "loop" | "ping-pong" | "one-shot", beats: 1 | 2 | 4 | 8) =>
      ({ ...sound, motion: { ...sound.motion, mode, beats } });
    assert.equal(motionLoopsWithTake(withMotion("loop", 4), 2), true);
    assert.equal(motionLoopsWithTake(withMotion("ping-pong", 8), 1), false);
    assert.equal(motionLoopsWithTake(withMotion("one-shot", 4), 4), false);
  });
});
