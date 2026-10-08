import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../../public/string-lab/experiments/resonant/engine.mjs';
import { demo } from '../../public/string-lab/experiments/resonant/view.mjs';

function render(sr, position, {seconds = 3, events = [], strength = 0.7} = {}) {
  const engine = new Engine(sr);
  engine.command({type: 'pluck', position, strength});
  const samples = new Float64Array(Math.round(sr * seconds));
  const queued = events.map(e => ({...e, sample: Math.round(e.at * sr)}));
  let event = 0;
  for (let i = 0; i < samples.length; i++) {
    while (event < queued.length && queued[event].sample <= i) engine.command(queued[event++].command);
    samples[i] = engine.processSample();
  }
  return samples;
}
function energy(samples, sr, from, to) {
  let sum = 0; const lo = Math.round(from * sr), hi = Math.min(samples.length, Math.round(to * sr));
  for (let i = lo; i < hi; i++) sum += samples[i] ** 2;
  return Math.sqrt(sum / (hi - lo));
}
// Scale-invariant spectral brightness: first-difference energy divided by
// signal energy. A simple gain change cannot pass this comparison.
function brightness(samples, sr, from = 0.03, to = 0.23) {
  let diff = 0, sum = 0;
  for (let i = Math.max(1, Math.round(from * sr)); i < Math.round(to * sr); i++) {
    diff += (samples[i] - samples[i - 1]) ** 2;
    sum += samples[i] ** 2;
  }
  return Math.sqrt(diff / sum);
}
for (const sr of [44100, 48000]) {
  test(`Resonant Ends anchor spectrum and decay differ beyond loudness at ${sr} Hz`, () => {
    const wood = render(sr, 0), open = render(sr, 0.5), metal = render(sr, 1);
    const levels = [wood, open, metal].map(a => energy(a, sr, 0.03, 0.23));
    assert.ok(Math.max(...levels) / Math.min(...levels) < 2, `attack RMS within 6 dB: ${levels}`);
    assert.ok(brightness(open, sr) > brightness(wood, sr) * 1.3, 'open has more upper-band energy than wood');
    assert.ok(brightness(metal, sr) > brightness(wood, sr) * 1.9, 'metal brightness differs after gain normalization');
    assert.ok(energy(metal, sr, 1, 2) > energy(open, sr, 1, 2) * 2, 'metal has a longer tail than open');
    assert.ok(energy(wood, sr, 0.7, 1) < energy(wood, sr, 0.03, 0.23) * 0.002, 'wood is conspicuously short');
    for (const a of [wood, open, metal]) {
      for (const sample of a) assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 0.68);
    }
  });
  test(`body strip transforms the current sound without an attack at ${sr} Hz`, () => {
    const unchanged = render(sr, 0.5);
    const toMetal = render(sr, 0.5, {events: [{at: 0.6, command: {type: 'body', value: 1}}]});
    const toWood = render(sr, 0.5, {events: [{at: 0.6, command: {type: 'body', value: 0}}]});
    assert.deepEqual(toMetal.slice(0, Math.round(0.6 * sr)), unchanged.slice(0, Math.round(0.6 * sr)));
    assert.ok(brightness(toMetal, sr, 0.8, 1.1) > brightness(unchanged, sr, 0.8, 1.1) * 1.5, 'existing note becomes brighter');
    assert.ok(energy(toMetal, sr, 1.3, 1.8) > energy(unchanged, sr, 1.3, 1.8) * 2, 'existing note has a stronger late tail');
    assert.ok(energy(toWood, sr, 1.1, 1.4) < energy(unchanged, sr, 1.1, 1.4) * 0.003, 'existing note rounds and decays quickly');
    const silent = new Engine(sr); silent.command({type: 'body', value: 1});
    for (let i = 0; i < sr; i++) assert.equal(silent.processSample(), 0, 'body motion alone never excites');
  });
  test(`body interpolation and repeated plucks stay finite at ${sr} Hz`, () => {
    const engine = new Engine(sr); let peak = 0;
    for (let i = 0; i < sr * 2; i++) {
      if (i % 131 === 0) engine.command({type: 'pluck', position: (i % 1000) / 1000, strength: 1, frequency: 220 + (i % 600)});
      if (i % 211 === 0) engine.command({type: 'body', value: (i % 1000) / 1000});
      const sample = engine.processSample();
      assert.ok(Number.isFinite(sample)); peak = Math.max(peak, Math.abs(sample));
    }
    assert.ok(peak <= 0.68);
    engine.command({type: 'stop'});
    for (let i = 0; i < 256; i++) assert.equal(engine.processSample(), 0);
    engine.command({type: 'pluck', position: Infinity, strength: NaN, frequency: -Infinity});
    for (let i = 0; i < sr / 10; i++) assert.ok(Number.isFinite(engine.processSample()));
    engine.command({type: 'reset'});
    for (let i = 0; i < 256; i++) assert.equal(engine.processSample(), 0);
  });
}
test('Resonant Ends demo is a bounded sorted timeline with a live transformation', () => {
  assert.ok(demo.duration >= 6 && demo.duration <= 12);
  for (let i = 1; i < demo.events.length; i++) assert.ok(demo.events[i].at >= demo.events[i - 1].at);
  const finalPluck = demo.events.findLast(e => e.command?.type === 'pluck').at;
  assert.ok(demo.events.filter(e => e.command?.type === 'body' && e.at > finalPluck).length >= 3);
});
