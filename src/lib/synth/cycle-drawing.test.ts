import assert from 'node:assert/strict';
import { it } from 'node:test';
import { cycleGestureIndex, cycleSampleIndex, paintCycleSpan } from './cycle-drawing.ts';
import { WAVE_SIZE } from './waveform.ts';

const original = () => Array.from({ length: WAVE_SIZE }, (_, i) => Math.sin(i / 13));
for (const [name, phases] of [
  ['left to right through seam', [509 / 512, 510 / 512, 511 / 512, 1]],
  ['leaving canvas to the right', [510 / 512, 1.02, 1.4]],
  ['right to left from seam', [1, 511 / 512, 510 / 512]],
  ['leaving canvas to the left', [2 / 512, 1 / 512, 0, -0.3]],
] as const) {
  it(name + ' only paints the local span', () => {
    const before = original();
    const wave = before.slice();
    let last = cycleGestureIndex(phases[0]!, WAVE_SIZE);
    phases.forEach((phase, i) => {
      const next = cycleGestureIndex(phase, WAVE_SIZE);
      paintCycleSpan(wave, last, next, i / 10);
      last = next;
    });
    assert.deepEqual(wave.slice(3, 509), before.slice(3, 509));
    assert.equal(wave.length, WAVE_SIZE);
  });
}
it('interpolates interior spans in either direction', () => {
  for (const reverse of [false, true]) {
    const wave = original();
    wave[reverse ? 30 : 20] = -1;
    paintCycleSpan(wave, reverse ? 30 : 20, reverse ? 20 : 30, 1);
    assert.equal(wave[25], 0);
    assert.equal(wave[reverse ? 20 : 30], 1);
  }
});
it('keeps seam identity without duplicating a sample or overwriting the interior', () => {
  const wave = original();
  paintCycleSpan(wave, 511, 512, 0.75);
  assert.equal(wave[0], 0.75);
  assert.equal(cycleSampleIndex(512, 512), cycleSampleIndex(0, 512));
  paintCycleSpan(wave, 512, 512, -0.5);
  assert.equal(wave[0], -0.5);
  assert.equal(wave.length, 512);
});
it('a complete forward gesture preserves the earlier drawn curve at the seam', () => {
  const wave = original();
  let last = 0;
  for (let i = 0; i <= 512; i++) {
    paintCycleSpan(wave, last, cycleGestureIndex(i / 512, 512), Math.cos(i / 17));
    last = i;
  }
  for (let i = 1; i < 512; i++) assert.ok(Math.abs(wave[i]! - Math.cos(i / 17)) < 1e-12);
  assert.equal(wave[0], Math.cos(512 / 17));
});
