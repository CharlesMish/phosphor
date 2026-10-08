/** Fixed-pitch string voice adapted from the original One String waveguide.
 * Natural decay and touch damping alter feedback energy, never output gain.
 * Retriggers prerender an 8 ms tail of the current composite voice, then crossfade
 * into a fresh excitation. This is bounded even when retriggering within a fade.
 * The short saved tail cannot respond to subsequent controls; the live loop does.
 */
export const OUTPUT_GAIN = 0.8;
export const DC_BLOCK_R = 0.999;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const NOTES = [];
for (let midi = 48; midi <= 72; midi += 1) {
  const name = `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
  NOTES.push({
    name,
    midi,
    frequency: 440 * 2 ** ((midi - 69) / 12),
  });
}

export function noteByName(name) {
  const found = NOTES.find((note) => note.name === name);
  if (!found) throw new Error(`Unknown note ${name}`);
  return found;
}

export function loopGainForT60(frequency, t60) {
  const trips = Math.max(1, t60 * frequency);
  const g = 10 ** (-3 / trips);
  return Math.min(0.9995, Math.max(0.02, g));
}

export function allpassPhaseDelay(omega, a) {
  if (omega < 1e-8) return (1 - a) / (1 + a);
  const cos = Math.cos(omega);
  const sin = Math.sin(omega);
  const numRe = a + cos;
  const numIm = -sin;
  const denRe = 1 + a * cos;
  const denIm = -a * sin;
  let phase = Math.atan2(numIm, numRe) - Math.atan2(denIm, denRe);
  if (phase > 0) phase -= 2 * Math.PI;
  return -phase / omega;
}

function solveAllpass(omega, targetDelay) {
  let lo = -0.95;
  let hi = 0.98;
  const delayAtLo = allpassPhaseDelay(omega, lo);
  const delayAtHi = allpassPhaseDelay(omega, hi);
  const increasing = delayAtHi > delayAtLo;
  for (let i = 0; i < 48; i += 1) {
    const mid = 0.5 * (lo + hi);
    const delay = allpassPhaseDelay(omega, mid);
    const tooLong = delay > targetDelay;
    if (increasing ? tooLong : !tooLong) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}

export function tuneLoop(sampleRate, frequency) {
  const period = sampleRate / frequency;
  const omega = (2 * Math.PI) / period;
  let M = Math.max(4, Math.round(period - 1.2));
  let best = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const target = period - M - 0.5;
    if (target < 0.2 || target > 1.35 || M < 4) {
      if (target < 0.2) M -= 1;
      else M += 1;
      continue;
    }
    const a = solveAllpass(omega, target);
    const got = allpassPhaseDelay(omega, a);
    const achieved = M + got + 0.5;
    const error = achieved - period;
    const candidate = { M, a, fractional: got, period, achieved, errorSamples: error, omega };
    if (!best || Math.abs(error) < Math.abs(best.errorSamples)) best = candidate;
    if (Math.abs(error) < 0.002) return candidate;
    if (got < target - 0.01) M -= 1;
    else M += 1;
  }
  if (!best || Math.abs(best.errorSamples) > 0.05) {
    throw new Error(`Could not tune ${frequency} Hz at ${sampleRate} Hz`);
  }
  return best;
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/** Position actually loaded into the pulse. Ends closer than 0.06 share that brightest pluck. */
export function excitationPosition(position) {
  const p = clamp(position, 0, 1);
  const beta = clamp(Math.min(p, 1 - p), 0.06, 0.5);
  return p > 0.5 ? 1 - beta : beta;
}

function excitation(M, position, strength) {
  const folded = clamp(Math.min(position, 1 - position), 0.06, 0.5);
  const out = new Float64Array(M);
  if (strength <= 0) return { samples: out, folded, limited: false };
  const width = clamp(Math.round(folded * M), 1, M - 1);
  const hi = (M - width) / M;
  const lo = -width / M;
  const raw = new Float64Array(M);
  for (let i = 0; i < M; i += 1) raw[i] = i < width ? hi : lo;
  for (let i = 0; i < M; i += 1) {
    const prev = raw[(i - 1 + M) % M];
    const next = raw[(i + 1) % M];
    out[i] = 0.25 * prev + 0.5 * raw[i] + 0.25 * next;
  }
  let sumSq = 0;
  for (let i = 0; i < M; i += 1) sumSq += out[i] * out[i];
  const rms = Math.sqrt(sumSq / M) || 1;
  const targetRms = strength * 0.22;
  let scale = targetRms / rms;
  let peak = 0;
  for (let i = 0; i < M; i += 1) peak = Math.max(peak, Math.abs(out[i] * scale));
  let limited = false;
  if (peak > 0.95) {
    scale *= 0.95 / peak;
    limited = true;
  }
  for (let i = 0; i < M; i += 1) out[i] *= scale;
  return { samples: out, folded, limited };
}


const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

class StringCore {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.delay = new Float64Array(Math.ceil(sampleRate / 60) + 8);
    this.M = 0;
    this.decay = 4;
    this.damping = 0;
    this.g = this.targetGain = .99;
    this.smoothing = 1 - Math.exp(-1 / (.004 * sampleRate));
    this.reset();
  }
  updateGain() {
    const t60 = 1 / (1 / this.decay + this.damping ** 1.6 / .028);
    this.targetGain = loopGainForT60(this.frequency || 220, t60);
  }
  setDecay(value) { this.decay = clamp(finite(value, this.decay), .05, 20); this.updateGain(); }
  setDamping(value) { this.damping = clamp(finite(value, this.damping), 0, 1); this.updateGain(); }
  reset() {
    this.delay.fill(0); this.writeIndex = 0;
    this.apIn = this.apOut = this.avgPrev = this.dcX1 = this.dcY1 = 0;
  }
  pluck({frequency, position, strength, decay}) {
    this.frequency = clamp(finite(frequency, 220), 60, Math.min(2000, this.sampleRate / 8));
    const tuning = tuneLoop(this.sampleRate, this.frequency);
    this.M = tuning.M; this.a = tuning.a;
    this.reset();
    this.setDecay(decay);
    // A held damper applies immediately to a new excitation; subsequent changes smooth.
    this.g = this.targetGain;
    const excited = excitation(this.M, clamp(finite(position, .5), 0, 1), clamp(finite(strength, .7), 0, 1));
    this.delay.set(excited.samples);
  }
  processSample() {
    if (!this.M) return 0;
    this.g += (this.targetGain - this.g) * this.smoothing;
    const x = this.delay[this.writeIndex];
    const ap = this.a * x + this.apIn - this.a * this.apOut;
    this.apIn = x; this.apOut = ap;
    let loop = .5 * (ap + this.avgPrev) * this.g;
    this.avgPrev = ap;
    if (Math.abs(loop) < 1e-20) loop = 0;
    this.delay[this.writeIndex] = loop;
    this.writeIndex = (this.writeIndex + 1) % this.M;
    const y = loop - this.dcX1 + DC_BLOCK_R * this.dcY1;
    this.dcX1 = loop; this.dcY1 = y;
    return y * OUTPUT_GAIN;
  }
}

export class StringVoice {
  constructor(sampleRate) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Unsupported sample rate');
    this.sampleRate = sampleRate;
    this.core = new StringCore(sampleRate);
    this.fadeLength = Math.max(8, Math.round(sampleRate * .008));
    this.tail = new Float64Array(this.fadeLength);
    this.scratch = new Float64Array(this.fadeLength);
    this.fadeIndex = this.fadeLength;
    this.decay = 4;
  }
  setDecay(value) {
    this.decay = clamp(finite(value, this.decay), .05, 20);
    this.core.setDecay(this.decay);
  }
  setDamping(value) { this.core.setDamping(value); }
  pluck(options = {}) {
    // Render into a different buffer: a rapid retrigger may still be reading tail.
    for (let i = 0; i < this.fadeLength; i++) this.scratch[i] = this._sample();
    [this.tail, this.scratch] = [this.scratch, this.tail];
    this.setDecay(options.decay ?? this.decay);
    this.core.pluck({...options, decay: this.decay});
    this.fadeIndex = 0;
  }
  _sample() {
    const fresh = this.core.processSample();
    if (this.fadeIndex >= this.fadeLength) return fresh;
    const index = this.fadeIndex++;
    const mix = .5 - .5 * Math.cos(Math.PI * index / (this.fadeLength - 1));
    return (1 - mix) * this.tail[index] + mix * fresh;
  }
  processSample() {
    const sample = this._sample();
    if (!Number.isFinite(sample)) { this.reset(); return 0; }
    // Smooth emergency headroom, shared by normal and crossfaded samples.
    return .78 * Math.tanh(sample / .78);
  }
  reset() {
    this.core.reset(); this.tail.fill(0); this.scratch.fill(0);
    this.fadeIndex = this.fadeLength;
  }
  stop() { this.reset(); }
}
