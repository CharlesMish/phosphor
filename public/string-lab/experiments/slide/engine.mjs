// A deliberately synthetic string: one continuously phased harmonic resonator.
// Pitch bends retune modes; they never replace the excitation or reset phase.
const TAU = 2 * Math.PI;
const clamp = (value, lo, hi, fallback) => Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : fallback;
const hz = midi => 440 * 2 ** ((midi - 69) / 12);

export class Engine {
  constructor(sampleRate) {
    this.sampleRate = clamp(sampleRate, 8000, 192000, 48000);
    this.modes = 14;
    this.phases = new Float64Array(this.modes);
    this.amplitudes = new Float64Array(this.modes);
    this.excitation = new Float64Array(this.modes);
    this.weights = Float64Array.from({length:this.modes}, (_, i) => 1 / (i + 1) ** 1.7);
    this.weightSum = this.weights.reduce((a,b) => a+b, 0);
    this.pitchSmoothing = 1 - Math.exp(-1 / (0.009 * this.sampleRate));
    this.decaySmoothing = 1 - Math.exp(-1 / (0.022 * this.sampleRate));
    this.attackSamples = Math.round(this.sampleRate * 0.007);
    this.command({type:'reset'});
  }

  command(event = {}) {
    if (event.type === 'reset') {
      this.phases.fill(0);
      this.midi = this.targetMidi = 62;
      this.decay = this.targetDecay = 4.2;
      this.amplitudes.fill(0);
      this.excitation.fill(0);
      this.attackRemaining = 0;
    } else if (event.type === 'stop') {
      this.amplitudes.fill(0);
      this.excitation.fill(0);
      this.attackRemaining = 0;
    } else if (event.type === 'pluck' || event.type === 'gesture') {
      this.targetMidi = clamp(event.midi, 57, 69, this.targetMidi);
      this.targetDecay = clamp(event.decay, 0.18, 8, this.targetDecay);
      if (event.type === 'pluck') {
        // An idle voice can begin directly on the touched note. An already
        // ringing voice keeps its smooth pitch trajectory through a retouch.
        if (!this.amplitudes.some(amplitude => amplitude > 0)) {
          this.midi = this.targetMidi;
          this.decay = this.targetDecay;
        }
        const strength = clamp(event.strength, 0.05, 1, 0.78);
        // Excitation enters over 7 ms. Repeated attacks add energy without any
        // waveform reset; each modal amplitude has a fixed conservative cap.
        for (let i = 0; i < this.modes; i++) {
          this.excitation[i] = strength * 0.64 * this.weights[i] / this.weightSum / this.attackSamples;
        }
        this.attackRemaining = this.attackSamples;
      }
    }
    // release deliberately changes no energy, pitch or phase.
  }

  processSample() {
    this.midi += (this.targetMidi - this.midi) * this.pitchSmoothing;
    this.decay += (this.targetDecay - this.decay) * this.decaySmoothing;
    const frequency = hz(this.midi);
    const baseLoss = Math.exp(-Math.log(1000) / (this.decay * this.sampleRate));
    let output = 0;
    for (let i = 0; i < this.modes; i++) {
      const n = i + 1;
      // Upper modes darken gently as the note fades. Changing decay acts on the
      // energy already present; lengthening it cannot recover lost amplitudes.
      let amplitude = this.amplitudes[i] * baseLoss ** (1 + i * 0.085);
      if (this.attackRemaining > 0) amplitude += this.excitation[i];
      amplitude = Math.min(amplitude, 0.75 * this.weights[i] / this.weightSum);
      if (amplitude < 1e-10) amplitude = 0;
      this.amplitudes[i] = amplitude;
      this.phases[i] += TAU * frequency * n / this.sampleRate;
      if (this.phases[i] >= TAU) this.phases[i] -= TAU;
      if (frequency * n < this.sampleRate * 0.45) output += amplitude * Math.sin(this.phases[i]);
    }
    if (this.attackRemaining > 0) this.attackRemaining--;
    return output;
  }
}
