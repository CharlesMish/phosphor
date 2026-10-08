import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine as Slide } from '../../public/string-lab/experiments/slide/engine.mjs';
import { Engine as Bow } from '../../public/string-lab/experiments/bow/engine.mjs';
import { Engine as Resonant } from '../../public/string-lab/experiments/resonant/engine.mjs';
import { Engine as Catch } from '../../public/string-lab/experiments/catch/engine.mjs';

const rates = [44100, 48000];
const render = (engine, seconds, rate) => {
  const output = new Float64Array(Math.round(seconds * rate));
  for (let i = 0; i < output.length; i++) {
    const value = engine.processSample();
    assert.ok(Number.isFinite(value), `nonfinite sample at ${i}`);
    assert.ok(Math.abs(value) <= 1, `sample outside headroom: ${value}`);
    output[i] = value;
  }
  return output;
};
const rms = array => Math.sqrt(array.reduce((sum, value) => sum + value * value, 0) / array.length);
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
const brightness = samples => {
  let energy = 0, differences = 0;
  for (let i = 1; i < samples.length; i++) {
    energy += samples[i] ** 2;
    differences += (samples[i] - samples[i - 1]) ** 2;
  }
  return Math.sqrt(differences / energy);
};
const bowFor = (engine, seconds, rate, speed, roughness = 0.4) => {
  let samples;
  for (let i = 0; i < Math.ceil(seconds / 0.05); i++) {
    engine.command({ type: 'bow', active: true, speed, roughness });
    samples = render(engine, 0.05, rate);
  }
  return samples;
};
const crossingPitch = (samples, rate) => {
  const positions = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) positions.push(i - 1 - samples[i - 1] / (samples[i] - samples[i - 1]));
  }
  assert.ok(positions.length > 10, 'enough cycles to measure pitch');
  return rate * (positions.length - 1) / (positions.at(-1) - positions[0]);
};

for (const rate of rates) {
  test(`independent catch: graded energy loss, muted attacks and no rebound at ${rate}`, () => {
    const tails = [0, 0.12, 0.55].map(amount => {
      const engine = new Catch(rate);
      engine.command({ type: 'pluck', strength: 0.8, position: 0.38 });
      render(engine, 0.1, rate);
      engine.command({ type: 'damp', amount });
      render(engine, 0.1, rate);
      return rms(render(engine, 0.05, rate));
    });
    assert.ok(tails[0] > tails[1] * 1.5 && tails[1] > tails[2] * 5, `graded energy loss: ${tails}`);
    const caught = new Catch(rate);
    caught.command({ type: 'pluck', strength: 0.8 });
    render(caught, 0.1, rate);
    caught.command({ type: 'damp', amount: 0.8 });
    render(caught, 0.4, rate);
    const beforeRelease = rms(render(caught, 0.05, rate));
    caught.command({ type: 'damp', amount: 0 });
    const afterRelease = rms(render(caught, 0.1, rate));
    assert.ok(afterRelease <= beforeRelease * 1.1 + 1e-9, `damper release resurrects energy: ${beforeRelease} -> ${afterRelease}`);
    const muted = new Catch(rate), open = new Catch(rate);
    muted.command({ type: 'damp', amount: 0.8 });
    for (const engine of [muted, open]) engine.command({ type: 'pluck', strength: 0.8 });
    const mutedAttack = rms(render(muted, 0.08, rate));
    const openAttack = rms(render(open, 0.08, rate));
    assert.ok(mutedAttack > 0 && mutedAttack < openAttack * 0.5, `held damping changes new attack: ${mutedAttack}/${openAttack}`);
  });

  test(`independent bow: continuous speed, explicit rest and stale input at ${rate}`, () => {
    const levels = [0.08, 0.3, 0.8].map(speed => {
      const engine = new Bow(rate);
      return rms(bowFor(engine, 0.8, rate, speed));
    });
    assert.ok(levels[0] > 0.005, `slow stroke audible: ${levels}`);
    assert.ok(levels[1] > levels[0] * 1.5 && levels[2] > levels[1] * 1.3, `graded response: ${levels}`);
    for (const explicit of [false, true]) {
      const engine = new Bow(rate);
      const driven = rms(bowFor(engine, 0.8, rate, 0.6));
      if (explicit) engine.command({ type: 'bow', active: true, speed: 0, roughness: 0.4 });
      render(engine, 3, rate);
      const tail = rms(render(engine, 0.2, rate));
      assert.ok(tail < driven * 0.005, `stuck exciter (explicit=${explicit}): ${tail}/${driven}`);
      engine.command({ type: 'stop' });
      assert.equal(rms(render(engine, 0.1, rate)), 0);
    }
    const smooth = brightness(bowFor(new Bow(rate), 0.8, rate, 0.5, 0));
    const rough = brightness(bowFor(new Bow(rate), 0.8, rate, 0.5, 1));
    assert.ok(rough > smooth * 1.4, `roughness beyond gain: ${smooth}, ${rough}`);
  });

  test(`independent resonant: anchor contrast beyond gain and live body change at ${rate}`, () => {
    const anchors = [0, 0.5, 1].map(position => {
      const engine = new Resonant(rate);
      engine.command({ type: 'pluck', position, strength: 0.75, frequency: 220 });
      render(engine, 0.08, rate);
      const early = render(engine, 0.16, rate);
      render(engine, 0.56, rate);
      const late = render(engine, 0.15, rate);
      return { brightness: brightness(early), early: rms(early), late: rms(late) };
    });
    assert.ok(anchors[2].brightness > anchors[0].brightness * 2, JSON.stringify(anchors));
    assert.ok(anchors[2].late > anchors[0].late * 8, JSON.stringify(anchors));
    const changed = new Resonant(rate), unchanged = new Resonant(rate);
    for (const engine of [changed, unchanged]) {
      engine.command({ type: 'pluck', position: 1, strength: 0.75 });
      render(engine, 0.3, rate);
    }
    changed.command({ type: 'body', value: 0 });
    render(changed, 0.15, rate); render(unchanged, 0.15, rate);
    const woodTail = render(changed, 0.2, rate), metalTail = render(unchanged, 0.2, rate);
    assert.ok(brightness(woodTail) < brightness(metalTail) * 0.7, 'existing tail changes spectrum');
    assert.ok(rms(woodTail) < rms(metalTail) * 0.5, 'existing tail changes decay');
    changed.command({ type: 'stop' });
    changed.command({ type: 'body', value: 1 });
    assert.equal(rms(render(changed, 0.2, rate)), 0, 'body change cannot create sound after stop');
  });

  test(`independent slide: one attack can visit three pitches and cannot revive a damped tail at ${rate}`, () => {
    const engine = new Slide(rate);
    engine.command({ type: 'pluck', midi: 57, strength: 0.8, decay: 8 });
    for (const midi of [57, 69, 62]) {
      engine.command({ type: 'gesture', midi, decay: 8 });
      render(engine, 0.12, rate);
      const samples = render(engine, 0.2, rate);
      const measured = crossingPitch(samples, rate);
      assert.ok(Math.abs(1200 * Math.log2(measured / hz(midi))) < 4, `${midi}: measured ${measured}`);
    }
    engine.command({ type: 'gesture', midi: 62, decay: 0.18 });
    render(engine, 0.6, rate);
    const quiet = rms(render(engine, 0.2, rate));
    engine.command({ type: 'gesture', midi: 69, decay: 8 });
    const after = rms(render(engine, 0.2, rate));
    assert.ok(after <= quiet * 1.05 + 1e-10, `tail resurrection: ${quiet} -> ${after}`);
    engine.command({ type: 'stop' });
    assert.equal(rms(render(engine, 0.05, rate)), 0);
    engine.command({ type: 'gesture', midi: 57, decay: 8 });
    assert.equal(rms(render(engine, 0.05, rate)), 0);
  });
}
