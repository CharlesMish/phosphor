import { renderTake } from '../../src/lib/synth/loop-render.ts';
import { snapshotSound } from '../../src/lib/synth/sound-file.ts';
import { DEFAULT_SOUND_SOURCE } from '../../src/lib/synth/store.ts';
import { encodeFloatWav } from '../../src/lib/synth/wav.ts';
import { generatePreset } from '../../src/lib/synth/waveform.ts';

const sampleRate = 48000;
const base = snapshotSound(DEFAULT_SOUND_SOURCE, 'qa');
const withChanges = (patch) => structuredClone({ ...base, ...patch });

// One bar at 120 BPM: four short notes on the beats (0.125 s each).
const fourBeats = [60, 64, 67, 72].flatMap((midi, id) => [
  { id, type: 'on', midi, beat: id },
  { id, type: 'off', midi, beat: id + 0.25 },
]);
// Two bars with a held chord across the bar line and a late note, so tails wrap.
const chord = [
  { id: 0, type: 'on', midi: 57, beat: 0 }, { id: 1, type: 'on', midi: 64, beat: 0 },
  { id: 0, type: 'off', midi: 57, beat: 3 }, { id: 1, type: 'off', midi: 64, beat: 3 },
  { id: 2, type: 'on', midi: 69, beat: 6.5 }, // held to the window end
];

function assert(condition, message) { if (!condition) throw new Error(message); }
function rms(x, from = 0, to = x.length) {
  let p = 0;
  for (let i = from; i < to; i++) p += x[i] ** 2;
  return Math.sqrt(p / Math.max(1, to - from));
}
function relativeError(a, b) {
  let num = 0, den = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - b[i]) ** 2; den += b[i] ** 2; }
  return Math.sqrt(num / den);
}
function firstAbove(x, from, threshold) {
  for (let i = from; i < x.length; i++) if (Math.abs(x[i]) > threshold) return i;
  return -1;
}

async function render(sound, events, bars, mode, extra = {}) {
  return renderTake({ sound, events, bars, mode, includeMotion: false, sampleRate, ...extra });
}

document.querySelector('#run').onclick = async () => {
  const out = document.querySelector('#result');
  out.textContent = 'Rendering…';
  const metrics = {};
  try {
    // 1. Note timing and the take's tail, dry so onsets are unambiguous.
    const dry = withChanges({ space: { ...base.space, mix: 0 } });
    const take = await render(dry, fourBeats, 1, 'take');
    const left = take.channels[0];
    metrics.takeSeconds = left.length / sampleRate;
    assert(Math.abs(metrics.takeSeconds - (2 + dry.voice.release + 0.1)) < 1e-3, 'Take length is loop plus tail');
    metrics.onsetErrorsMs = [0, 0.5, 1, 1.5].map((t) => {
      const expected = Math.round(t * sampleRate);
      const found = firstAbove(left, Math.max(0, expected - 0.04 * sampleRate), 1e-4);
      return +(((found - expected) / sampleRate) * 1000).toFixed(3);
    });
    // The first sample above the threshold sits a few ms into each 40 ms attack;
    // what matters is that the offset is identical, i.e. notes are exactly a beat apart.
    metrics.beatSpacingErrorMs = Math.max(...metrics.onsetErrorsMs.slice(1).map((e, i) => Math.abs(e - metrics.onsetErrorsMs[i])));
    assert(metrics.onsetErrorsMs.every((e) => e >= 0 && e < 10), 'Notes start on their beats');
    assert(metrics.beatSpacingErrorMs < 0.1, 'Notes are exactly one beat apart');
    metrics.takeEndRms = rms(left, left.length - 0.02 * sampleRate);
    assert(metrics.takeEndRms < 1e-4, 'Take ends after its tail has decayed');

    // 2. Seamless loop: the kept pass equals later passes, i.e. the loop has settled.
    //    A note held across the bar line plus a note on beat 1 exercises the
    //    look-ahead gain rebalance at the seam.
    const wet = await render(base, chord, 2, 'seamless');
    metrics.seamlessSeconds = wet.channels[0].length / sampleRate;
    assert(Math.abs(metrics.seamlessSeconds - 4) < 1e-4, 'Seamless file is exactly one loop');
    const later = await render(base, chord, 2, 'seamless', { extraPasses: 3 });
    metrics.keptFrom = [wet.plan.keepFromSeconds, later.plan.keepFromSeconds];
    metrics.steadyStateError = relativeError(wet.channels[0], later.channels[0]);
    metrics.headRmsWithWrappedTail = rms(wet.channels[0], 0, 0.05 * sampleRate);
    assert(metrics.headRmsWithWrappedTail > 1e-3, 'Held note and Space tails wrap into the loop start');

    // 3. Stereo: Chorus produces different left and right channels.
    const chorus = withChanges({ chorus: { ...base.chorus, mix: 0.5 } });
    const stereo = await render(chorus, fourBeats, 1, 'take');
    metrics.chorusSideRatio = rms(stereo.channels[0].map((v, i) => v - stereo.channels[1][i])) / rms(stereo.channels[0]);
    assert(metrics.chorusSideRatio > 0.01, 'Chorus output is stereo');

    // 4. Motion: included only when asked, and only through enabled routes.
    const sine = generatePreset('sine'), square = generatePreset('square');
    const morphing = withChanges({
      cycle: { ...base.cycle, slotA: sine, slotB: square, morph: 0, morphLive: true },
      motion: { ...base.motion, mode: 'loop', beats: 2, routes: { ...base.motion.routes, cycle: { enabled: true, inverted: false } } },
    });
    const still = await render(morphing, chord, 2, 'take');
    const moving = await render(morphing, chord, 2, 'take', { includeMotion: true });
    metrics.motionChange = relativeError(moving.channels[0], still.channels[0]);
    assert(moving.motion && metrics.motionChange > 0.05, 'Motion changes the render when included');
    const noRoutes = withChanges({ motion: { ...base.motion, routes: { ...base.motion.routes, cycle: { enabled: false, inverted: false } } } });
    const a = await render(noRoutes, chord, 2, 'take');
    const b = await render(noRoutes, chord, 2, 'take', { includeMotion: true });
    metrics.motionWithoutRoutesError = relativeError(b.channels[0], a.channels[0]);
    assert(!b.motion && metrics.motionWithoutRoutesError === 0, 'Motion without destinations leaves the render untouched');

    // 5. The WAV decodes in this browser to the same samples.
    const bytes = encodeFloatWav(wet.channels, sampleRate, { title: 'qa', software: 'Phosphor', json: wet.provenance });
    const decoded = await new OfflineAudioContext(2, 1, sampleRate).decodeAudioData(bytes.buffer.slice(0));
    metrics.decodedChannels = decoded.numberOfChannels;
    metrics.decodedMaxError = Math.max(...[0, 1].map((c) => {
      const d = decoded.getChannelData(c);
      let m = 0;
      for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i] - wet.channels[c][i]));
      return m;
    }));
    assert(decoded.length === wet.channels[0].length && metrics.decodedMaxError === 0, 'WAV decodes exactly');

    metrics.peaks = { take: take.peak, seamless: wet.peak, chorus: stereo.peak, motion: moving.peak };
    assert(Object.values(metrics.peaks).every((p) => Number.isFinite(p) && p > 0.01 && p < 1.01), 'Peaks are finite and inside the output stage');
    assert(metrics.steadyStateError < 1e-4, 'Kept pass matches the steady-state loop');
    out.textContent = 'PASS\n' + JSON.stringify(metrics, null, 2);
  } catch (error) {
    out.textContent = 'FAIL\n' + (error.stack ?? error) + '\n' + JSON.stringify(metrics, null, 2);
  }
};
