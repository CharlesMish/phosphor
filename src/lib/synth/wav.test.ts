import assert from "node:assert/strict";
import { it } from "node:test";
import { decodeFloatWav, encodeFloatWav } from "./wav.ts";

it("keeps float samples, including peaks above full scale", () => {
  const left = Float32Array.from([0, -1.25, 0.5]);
  const right = Float32Array.from([0.25, 1.5, -0.125]);
  const bytes = encodeFloatWav([left, right], 48000, {
    title: "Phosphor phrase",
    software: "Phosphor",
    comment: "Render from start. Not a recording of live playback.",
    json: { format: "phosphor-phrase", peak: 1.5 },
  });
  const decoded = decodeFloatWav(bytes);
  assert.equal(decoded.sampleRate, 48000);
  assert.deepEqual(Array.from(decoded.channels[0]!), Array.from(left));
  assert.deepEqual(Array.from(decoded.channels[1]!), Array.from(right));
  assert.equal(decoded.info.INAM, "Phosphor phrase");
  assert.match(decoded.info.ICMT, /Not a recording of live playback/);
  assert.equal((decoded.json as { peak: number }).peak, 1.5);
});
