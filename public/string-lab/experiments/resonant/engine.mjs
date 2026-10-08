import { StringVoice } from '../../shared/string-voice.mjs';

const TAU = Math.PI * 2;
const clamp = (value, lo, hi, fallback) => Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : fallback;
const lerp = (a, b, t) => a + (b - a) * t;
const landscape = (left, middle, right, x) => x <= 0.5 ? lerp(left, middle, x * 2) : lerp(middle, right, (x - 0.5) * 2);

// A deliberately designed body, not a model of a real string's opposing ends.
// The open-string voice is joined by seven inharmonic, damped body modes. Body
// changes mix/filter/energy loss of the existing state; they never excite it.
export class Engine {
  constructor(sampleRate) {
    this.sampleRate = clamp(sampleRate, 8000, 192000, 48000);
    this.string = new StringVoice(this.sampleRate);
    this.ratios = [1, 2.04, 3.96, 5.41, 6.8, 8.93, 11.2];
    this.modeX = new Float64Array(7);
    this.modeY = new Float64Array(7);
    this.cosines = new Float64Array(7);
    this.sines = new Float64Array(7);
    this.woodWeights = [0.8, 0.18, 0.06, 0, 0, 0, 0];
    this.openWeights = [0.15, 0.06, 0.025, 0.01, 0.005, 0, 0];
    this.metalWeights = [0.6, 0.44, 0.4, 0.33, 0.27, 0.22, 0.18];
    this.bodySmoothing = 1 - Math.exp(-1 / (0.025 * this.sampleRate));
    this.reset();
  }

  reset() {
    this.string.reset();
    this.string.setDamping(0);
    this.modeX.fill(0);
    this.modeY.fill(0);
    this.body = this.targetBody = 0.5;
    this.filter = 0;
    this.frequency = 220;
    this.tick = 0;
    this.setTuning(220);
    this.updateCoefficients();
  }

  stop() {
    this.string.stop();
    this.modeX.fill(0);
    this.modeY.fill(0);
    this.filter = 0;
  }

  setTuning(frequency) {
    this.frequency = frequency;
    for (let i = 0; i < this.ratios.length; i++) {
      const hz = Math.min(this.sampleRate * 0.42, frequency * this.ratios[i]);
      const theta = TAU * hz / this.sampleRate;
      this.cosines[i] = Math.cos(theta);
      this.sines[i] = Math.sin(theta);
    }
  }

  updateCoefficients() {
    const x = this.body;
    this.decay = landscape(0.48, 3.8, 7.5, x);
    this.string.setDecay(this.decay);
    const cutoff = landscape(620, 5500, 8500, x);
    this.filterAmount = 1 - Math.exp(-TAU * Math.min(cutoff, this.sampleRate * 0.42) / this.sampleRate);
    this.bodyRadius = Math.exp(-6.907755 / (this.decay * this.sampleRate));
  }

  command(event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'reset') this.reset();
    else if (event.type === 'stop') this.stop();
    else if (event.type === 'body') this.targetBody = clamp(event.value, 0, 1, this.targetBody);
    else if (event.type === 'pluck') {
      const position = clamp(event.position, 0, 1, 0.5);
      const strength = clamp(event.strength, 0, 1, 0.7);
      const frequency = clamp(event.frequency, 80, 880, 220);
      this.targetBody = position;
      this.setTuning(frequency);
      // Pluck geometry remains centered so the designed body, rather than a
      // tiny ideal-string position difference, is the audible experiment.
      this.string.pluck({frequency, position: 0.32, strength, decay: landscape(0.48, 3.8, 7.5, position)});
      for (let i = 0; i < this.ratios.length; i++) {
        // Add velocity, not displacement: re-excitation preserves the output
        // value. Bounded modal states prevent repeated attacks accumulating.
        this.modeY[i] = Math.max(-0.45, Math.min(0.45, this.modeY[i] + strength * 0.32));
      }
    }
  }

  processSample() {
    this.body += (this.targetBody - this.body) * this.bodySmoothing;
    if ((this.tick++ & 31) === 0) this.updateCoefficients();
    const raw = this.string.processSample();
    this.filter += this.filterAmount * (raw - this.filter);
    let modal = 0;
    for (let i = 0; i < this.ratios.length; i++) {
      const x = this.modeX[i];
      const y = this.modeY[i];
      // Slightly faster loss for higher body modes, preserving a metallic tail.
      const radius = this.bodyRadius - i * 0.0000005 * 48000 / this.sampleRate;
      this.modeX[i] = (x * this.cosines[i] + y * this.sines[i]) * radius;
      this.modeY[i] = (y * this.cosines[i] - x * this.sines[i]) * radius;
      const weight = landscape(this.woodWeights[i], this.openWeights[i], this.metalWeights[i], this.body);
      modal += this.modeX[i] * weight;
    }
    const stringMix = landscape(1.35, 1.12, 0.48, this.body);
    const modalMix = landscape(0.50, 0.22, 0.84, this.body);
    const sample = this.filter * stringMix + modal * modalMix;
    return Math.tanh(sample * 1.1) * 0.68;
  }
}
