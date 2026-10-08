import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../../public/string-lab/experiments/ribbon/engine.mjs';

const rms = samples => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
const magnitude = (samples, sampleRate, frequency) => {
  let real = 0, imaginary = 0;
  for (let i = 0; i < samples.length; i++) {
    // Hann-windowed measurement tolerates the fractional test frequencies.
    const weight = .5 - .5 * Math.cos(2 * Math.PI * i / (samples.length - 1));
    const phase = 2 * Math.PI * frequency * i / sampleRate;
    real += samples[i] * Math.cos(phase) * weight;
    imaginary += samples[i] * Math.sin(phase) * weight;
  }
  return 4 * Math.hypot(real, imaginary) / samples.length;
};

function render(engine, seconds, {speed=.6, midi=62, active=true, refresh=true}={}) {
  const count = Math.round(seconds * engine.sampleRate);
  const interval = Math.round(.05 * engine.sampleRate);
  const samples = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    if (refresh && i % interval === 0) {
      engine.command({type:'bow', active, speed, midi});
    }
    samples[i] = engine.processSample();
    assert.ok(Number.isFinite(samples[i]), 'sample is finite');
    assert.ok(Math.abs(samples[i]) < .68, 'output keeps bounded headroom');
  }
  return samples;
}

for (const sampleRate of [44100, 48000]) {
  test(`ribbon ${sampleRate}: contact and pitch changes cannot excite a stationary bow`, () => {
    const engine = new Engine(sampleRate);
    assert.equal(rms(render(engine, .2, {refresh:false})), 0);
    for (const midi of [57, 69, 60.4, 66.7]) {
      assert.equal(rms(render(engine, .2, {speed:0, midi})), 0);
    }
    assert.equal(rms(render(engine, .2, {active:false, speed:1})), 0);
  });

  test(`ribbon ${sampleRate}: bow speed provides a useful dynamic range`, () => {
    const levels = [.06, .4, .95].map(speed => {
      const wave = render(new Engine(sampleRate), 1, {speed});
      return rms(wave.slice(Math.round(sampleRate * .5)));
    });
    assert.ok(levels[0] > .008, 'a slow bow is audible');
    assert.ok(levels[1] > levels[0] * 2.5, 'medium bow is materially stronger');
    assert.ok(levels[2] > levels[1] * 1.45, 'fast bow still adds useful intensity');
    assert.ok(levels[2] < .3, 'full bow stays at conservative level');
  });

  test(`ribbon ${sampleRate}: a live bow glides from A3 to A4 without retriggering`, () => {
    const engine = new Engine(sampleRate);
    const low = render(engine, .8, {midi:57});
    const high = render(engine, .8, {midi:69});
    const lowEnd = low.slice(-Math.round(sampleRate * .3));
    const highEnd = high.slice(-Math.round(sampleRate * .3));
    assert.ok(magnitude(lowEnd, sampleRate, 220) > .1, 'first pitch has a clear A3 fundamental');
    assert.ok(magnitude(highEnd, sampleRate, 440) > .1, 'same sustained voice reaches A4');
    assert.ok(magnitude(highEnd, sampleRate, 220) < .0003, 'old fundamental is gone');
    assert.ok(rms(high.slice(0, Math.round(sampleRate * .03))) > rms(lowEnd) * .7,
      'pitch transition does not insert a fresh attack or a gap');
    const aroundBend = Float64Array.from([...low.slice(-100), ...high.slice(0, Math.round(sampleRate * .07))]);
    let largestStep = 0;
    for (let i = 1; i < aroundBend.length; i++) largestStep = Math.max(largestStep, Math.abs(aroundBend[i] - aroundBend[i-1]));
    assert.ok(largestStep < .075, `continuous phase keeps the bend smooth (largest sample step ${largestStep})`);
  });

  test(`ribbon ${sampleRate}: small continuous bends produce audible vibrato`, () => {
    const engine = new Engine(sampleRate);
    render(engine, .6, {midi:62});
    const wave = new Float64Array(sampleRate);
    const interval = Math.round(sampleRate / 120);
    for (let i = 0; i < wave.length; i++) {
      if (i % interval === 0) engine.command({type:'bow', active:true, speed:.6,
        midi:62 + .28 * Math.sin(2 * Math.PI * 5 * i / sampleRate)});
      wave[i] = engine.processSample();
    }
    const fundamental = 440 * 2 ** ((62 - 69) / 12);
    const center = magnitude(wave, sampleRate, fundamental);
    const sidebands = magnitude(wave, sampleRate, fundamental-5) + magnitude(wave, sampleRate, fundamental+5);
    assert.ok(center > .07, 'fundamental remains present');
    assert.ok(sidebands > center * .6, 'sub-semitone rocking reaches the sound');
  });

  test(`ribbon ${sampleRate}: reversals bridge, then stillness and release fade naturally`, () => {
    for (const active of [true, false]) {
      const engine = new Engine(sampleRate);
      const before = rms(render(engine, .8).slice(-Math.round(sampleRate * .1)));
      const tail = render(engine, 2.5, {speed:0, active});
      assert.ok(rms(tail.slice(0, Math.round(sampleRate * .05))) > before * .7,
        'a brief reversal does not chop the voice');
      assert.ok(rms(tail.slice(Math.round(sampleRate*.9), sampleRate)) < before * .03,
        'rest supplies no further energy');
      assert.ok(rms(tail.slice(-Math.round(sampleRate * .2))) < .00001,
        'the natural tail reaches practical silence');
    }
  });

  test(`ribbon ${sampleRate}: abandoned controls cannot leave a hanging drone`, () => {
    const engine = new Engine(sampleRate);
    render(engine, .8, {speed:1});
    const abandoned = render(engine, 2.8, {refresh:false});
    assert.ok(rms(abandoned.slice(0, Math.round(sampleRate*.1))) > .05, 'tone was sounding');
    assert.ok(rms(abandoned.slice(-Math.round(sampleRate*.2))) < .00001, 'watchdog retires the exciter');
  });
}

test('ribbon: malformed input, pitch extremes, stop and reset stay bounded across sample rates', () => {
  for (const sampleRate of [8000, 44100, 48000, 96000]) {
    const engine = new Engine(sampleRate);
    for (const event of [null, undefined, 'bow', {}, {type:'unknown'}]) engine.command(event);
    for (const value of [NaN, Infinity, -Infinity, -100, 100, 'loud', null]) {
      engine.command({type:'bow', active:true, speed:value, midi:value});
      render(engine, .02, {refresh:false});
    }
    render(engine, .4, {speed:1, midi:69});
    engine.command({type:'stop'});
    assert.equal(rms(render(engine, .1, {refresh:false})), 0, 'stop fully clears energy');
    render(engine, .4, {speed:1, midi:57});
    engine.command({type:'reset'});
    assert.equal(rms(render(engine, .1, {refresh:false})), 0, 'reset fully clears energy');
  }
});
