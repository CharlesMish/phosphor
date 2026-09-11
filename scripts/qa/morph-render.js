import { SynthEngine, cycleMorphSamples } from '../../src/lib/synth/engine.ts';
import { generatePreset } from '../../src/lib/synth/waveform.ts';

const sampleRate = 48000;
const seconds = 1.4;
const sine = generatePreset('sine');
const near = sine.map((x, i) => x + 0.01 * Math.sin(4 * Math.PI * i / sine.length));

async function render(mode, a, b, position) {
  const ctx = new OfflineAudioContext(1, sampleRate * seconds, sampleRate);
  const engine = new SynthEngine();
  // Deliberate test seam: use the production graph with an offline clock.
  // All source creation, gain ramps, and replacements run through engine APIs.
  engine.ctx = ctx;
  engine.buildGraph();
  engine.unlock = () => true;
  engine.setParams({ attack: 0.004 });
  if (mode === 'legacy') engine.setWaveform(cycleMorphSamples(a, b, position(0)), true);
  else engine.setCycleMorph(a, b, position(0));
  engine.noteOn(69);
  engine.master.disconnect();
  engine.voices.get(69).env.connect(ctx.destination);
  let updates = 0;
  const suspensions = [];
  if (mode !== 'reference') {
    for (let tick = 3; tick <= 38; tick++) {
      const time = tick / 30;
      suspensions.push(ctx.suspend(time).then(() => {
        const value = position(ctx.currentTime);
        if (mode === 'legacy') engine.setWaveform(cycleMorphSamples(a, b, value), true);
        else engine.setCycleMorph(a, b, value);
        updates++;
        return ctx.resume();
      }));
    }
  }
  const buffer = await ctx.startRendering();
  await Promise.all(suspensions);
  const samples = buffer.getChannelData(0).slice();
  if (!samples.every(Number.isFinite)) throw new Error('Non-finite audio');
  return { samples, updates };
}

function rms(samples, start = 0.4, end = 1.2) {
  let power = 0;
  const first = Math.round(start * sampleRate), last = Math.round(end * sampleRate);
  for (let i = first; i < last; i++) power += samples[i] ** 2;
  return Math.sqrt(power / (last - first));
}
function relativeError(actual, reference) {
  return rms(actual.map((x, i) => x - reference[i])) / rms(reference);
}
function assert(condition, message) { if (!condition) throw new Error(message); }

document.querySelector('#run').onclick = async () => {
  const result = document.querySelector('#result');
  result.textContent = 'Rendering…';
  try {
    const reference = await render('reference', sine, sine, () => 0.5);
    const legacy = await render('legacy', sine, sine, () => 0.5);
    const flat = await render('morph', sine, sine, () => 0.5);
    const movingIdentical = await render('morph', sine, sine, t => (t * 2) % 1);
    const tiny = await render('morph', sine, near, t => 0.5 + 0.01 * Math.sin(2 * Math.PI * t));
    const tinyReference = await render('reference', sine, near, () => 0.5);
    const inverse = sine.map(x => -x);
    const cancellation = await render('morph', sine, inverse, () => 0.5);
    const nearCancellation = await render('morph', sine, inverse, () => 0.49);
    const metrics = {
      legacyFlatRelativeError: relativeError(legacy.samples, reference.samples),
      fixedFlatRelativeError: relativeError(flat.samples, reference.samples),
      movingIdenticalRelativeError: relativeError(movingIdentical.samples, reference.samples),
      tinyMotionRelativeError: relativeError(tiny.samples, tinyReference.samples),
      cancellationRms: rms(cancellation.samples),
      nearCancellationAmplitudeRatio: rms(nearCancellation.samples) / rms(reference.samples),
      updatesPerMovingRender: flat.updates,
    };
    assert(metrics.legacyFlatRelativeError > 0.1, 'Legacy fault did not reproduce');
    assert(metrics.fixedFlatRelativeError < 1e-5, 'Flat Motion altered a held sine');
    assert(metrics.movingIdenticalRelativeError < 1e-5, 'Identical endpoints changed across Motion, including loop wraps');
    assert(metrics.tinyMotionRelativeError < 0.001, 'Tiny Motion introduced a large signal change');
    assert(metrics.cancellationRms < 1e-6, 'Opposite endpoints failed to cancel');
    assert(Math.abs(metrics.nearCancellationAmplitudeRatio - 0.02) < 1e-4, 'Near cancellation was boosted');
    result.textContent = 'PASS\n' + JSON.stringify(metrics, null, 2);
  } catch (error) {
    result.textContent = 'FAIL\n' + (error.stack ?? error);
  }
};
