/**
 * One plucked string: a Karplus–Strong digital waveguide.
 *
 * Loop (one sample):
 *   1. Read a circular delay of M samples.
 *   2. First-order allpass fractional delay, coefficient solved so the
 *      allpass phase delay at the fundamental makes the whole loop
 *      equal sampleRate / frequency.
 *   3. Two-point averager 0.5 * (x + x[n-1]), linear phase, delay 0.5.
 *   4. Multiply by loop gain g < 1. g is set from the requested T60
 *      (about −60 dB at the fundamental). It does not change loop phase.
 *
 * Excitation (replaces the delay contents; it does not layer onto them):
 *   A zero-mean rectangular pulse whose width is the folded pluck
 *   position. That is the round-trip traveling wave that belongs to an
 *   ideal triangular displacement plucked at that point. Strength sets
 *   the RMS of this pulse. A 3-point smooth takes the edge off the
 *   discontinuity. This is not a noise burst and not a sampled guitar.
 *
 * Position is folded with min(p, 1−p). On this ideal string the two ends
 * share a magnitude spectrum. There is no bridge pickup and no body.
 *
 * The output DC blocker sits outside the loop so it is not part of the
 * tuning delay. Stop ramps for a few milliseconds, then clears all state.
 */

export const OUTPUT_GAIN = 0.9;
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

export class StringModel {
  constructor(sampleRate) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000) {
      throw new Error(`Unusable sample rate ${sampleRate}`);
    }
    this.sampleRate = sampleRate;
    this.delay = new Float64Array(0);
    this.writeIndex = 0;
    this.M = 0;
    this.a = 0;
    this.apIn = 0;
    this.apOut = 0;
    this.avgPrev = 0;
    this.g = 0.99;
    this.frequency = 0;
    this.t60 = 2.5;
    this.dcX1 = 0;
    this.dcY1 = 0;
    this.dcR = DC_BLOCK_R;
    this.outputGain = OUTPUT_GAIN;
    this.stopSamplesLeft = 0;
    this.stopRampLength = 0;
    this.stopping = false;
    this.clipCount = 0;
    this.peakAbs = 0;
    this.lastPeak = 0;
    this.lastRms = 0;
    this.tuning = null;
  }

  setDecay(t60) {
    this.t60 = clamp(t60, 0.05, 20);
    if (this.frequency > 0) this.g = loopGainForT60(this.frequency, this.t60);
  }

  resetMemory() {
    this.delay.fill(0);
    this.writeIndex = 0;
    this.apIn = 0;
    this.apOut = 0;
    this.avgPrev = 0;
    this.dcX1 = 0;
    this.dcY1 = 0;
    this.stopping = false;
    this.stopSamplesLeft = 0;
    this.stopRampLength = 0;
  }

  stop() {
    if (this.M === 0) {
      this.resetMemory();
      return;
    }
    this.stopRampLength = Math.max(8, Math.round(0.01 * this.sampleRate));
    this.stopSamplesLeft = this.stopRampLength;
    this.stopping = true;
  }

  pluck({ frequency, position, strength, decay }) {
    const freq = clamp(frequency, 60, 2000);
    const pos = clamp(position, 0, 1);
    const amp = clamp(strength, 0, 1);
    const t60 = clamp(decay, 0.05, 20);
    const tuning = tuneLoop(this.sampleRate, freq);
    if (tuning.M !== this.M) {
      this.delay = new Float64Array(tuning.M);
      this.M = tuning.M;
    }
    this.tuning = tuning;
    this.a = tuning.a;
    this.frequency = freq;
    this.setDecay(t60);
    this.stopping = false;
    this.stopSamplesLeft = 0;
    const excited = excitation(this.M, pos, amp);
    this.delay.set(excited.samples);
    this.writeIndex = 0;
    this.apIn = 0;
    this.apOut = 0;
    this.avgPrev = 0;
    this.dcX1 = 0;
    this.dcY1 = 0;
    this.foldedPosition = excited.folded;
    this.peakLimited = excited.limited;
  }

  processSample() {
    if (this.M === 0) return 0;
    const x = this.delay[this.writeIndex];
    const yAp = this.a * x + this.apIn - this.a * this.apOut;
    this.apIn = x;
    this.apOut = yAp;
    let yLoop = 0.5 * (yAp + this.avgPrev) * this.g;
    this.avgPrev = yAp;
    if (Math.abs(yLoop) < 1e-20) yLoop = 0;
    this.delay[this.writeIndex] = yLoop;
    this.writeIndex += 1;
    if (this.writeIndex >= this.M) this.writeIndex = 0;

    let y = yLoop - this.dcX1 + this.dcR * this.dcY1;
    this.dcX1 = yLoop;
    this.dcY1 = y;
    y *= this.outputGain;

    if (this.stopping) {
      const gain = this.stopSamplesLeft <= 0
        ? 0
        : 0.5 * (1 - Math.cos(Math.PI * (this.stopSamplesLeft / this.stopRampLength)));
      y *= gain;
      this.stopSamplesLeft -= 1;
      if (this.stopSamplesLeft <= 0) {
        this.resetMemory();
        return 0;
      }
    }

    if (y > 1 || y < -1) {
      this.clipCount += 1;
      y = y > 1 ? 1 : -1;
    }
    return y;
  }

  render(frameCount) {
    const out = new Float64Array(frameCount);
    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < frameCount; i += 1) {
      const sample = this.processSample();
      out[i] = sample;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSq += sample * sample;
      if (!Number.isFinite(sample)) {
        throw new Error('Non-finite sample');
      }
    }
    this.lastPeak = peak;
    this.lastRms = Math.sqrt(sumSq / Math.max(1, frameCount));
    if (peak > this.peakAbs) this.peakAbs = peak;
    return out;
  }

  renderInto(channel) {
    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < channel.length; i += 1) {
      const sample = this.processSample();
      channel[i] = sample;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSq += sample * sample;
    }
    this.lastPeak = peak;
    this.lastRms = channel.length ? Math.sqrt(sumSq / channel.length) : 0;
    if (peak > this.peakAbs) this.peakAbs = peak;
  }
}
