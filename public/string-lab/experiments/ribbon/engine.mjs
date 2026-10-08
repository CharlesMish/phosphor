// Bowed Slide: a synthetic harmonic resonator, not a physical violin model.
// Commands: {type:'bow', active:Boolean, speed:0..1, midi:57..69}, stop, reset.
// Pitch never retriggers the voice. Only fresh movement supplies energy.
const TAU = 2 * Math.PI;
const clamp = (value, low, high, fallback) => Number.isFinite(value)
  ? Math.max(low, Math.min(high, value)) : fallback;
const hz = midi => 440 * 2 ** ((midi - 69) / 12);

export class Engine {
  constructor(sampleRate) {
    this.sampleRate = clamp(sampleRate, 8000, 192000, 48000);
    this.modes = Array.from({length:12}, (_, index) => {
      const harmonic = index + 1;
      return {
        harmonic,
        amplitude:0,
        weight:(harmonic % 2 ? 1 : .76) / harmonic ** 1.48,
        rise:1 - Math.exp(-1 / (this.sampleRate * .048)),
        fall:Math.exp(-1 / (this.sampleRate * (.12 + .10 / harmonic))),
      };
    });
    this.pitchEase = 1 - Math.exp(-1 / (this.sampleRate * .009));
    this.speedEase = 1 - Math.exp(-1 / (this.sampleRate * .026));
    this.frictionEase = 1 - Math.exp(-TAU * 1600 / this.sampleRate);
    this.watchdogSamples = Math.round(this.sampleRate * .14);
    this.reset();
  }

  reset() {
    this.active = false;
    this.speed = this.speedTarget = 0;
    this.midi = this.targetMidi = 62;
    this.age = this.watchdogSamples;
    this.phase = 0;
    this.noiseState = 0x48b09f;
    this.noiseLow = 0;
    for (const mode of this.modes) mode.amplitude = 0;
  }

  command(event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'stop' || event.type === 'reset') {
      // The shared router fades the outgoing samples before switching/resetting.
      this.reset();
    } else if (event.type === 'bow') {
      this.active = event.active === true;
      this.speedTarget = clamp(event.speed, 0, 1, 0);
      this.targetMidi = clamp(event.midi, 57, 69, this.targetMidi);
      this.age = 0;
      // Starting from silence can use the touched pitch immediately. A live
      // voice retains its phase and smoothly bends through every pitch change.
      if (this.speed === 0 && this.modes.every(mode => mode.amplitude === 0)) {
        this.midi = this.targetMidi;
      }
    }
  }

  processSample() {
    this.age = Math.min(this.age + 1, this.watchdogSamples);
    const driving = this.active && this.age < this.watchdogSamples;
    const targetSpeed = driving ? this.speedTarget : 0;
    this.speed += (targetSpeed - this.speed) * this.speedEase;
    if (this.speed < 1e-10) this.speed = 0;
    this.midi += (this.targetMidi - this.midi) * this.pitchEase;
    const frequency = hz(this.midi);
    this.phase += TAU * frequency / this.sampleRate;
    if (this.phase >= TAU) this.phase -= TAU;

    // No velocity offset: still contact and sideways-only pitch motion are
    // silent until a bow stroke actually supplies energy.
    const energy = this.speed ** .72;
    let output = 0;
    for (const mode of this.modes) {
      const wanted = .37 * energy * mode.weight;
      mode.amplitude = wanted > mode.amplitude
        ? mode.amplitude + (wanted - mode.amplitude) * mode.rise
        : wanted + (mode.amplitude - wanted) * mode.fall;
      if (mode.amplitude < 1e-10) mode.amplitude = 0;
      // A short taper below Nyquist also makes unusually low sample rates safe.
      const normalizedFrequency = frequency * mode.harmonic / this.sampleRate;
      const taper = normalizedFrequency <= .38 ? 1
        : normalizedFrequency >= .46 ? 0
        : .5 + .5 * Math.cos(Math.PI * (normalizedFrequency - .38) / .08);
      const angle = this.phase * mode.harmonic;
      const wave = mode.harmonic % 2 ? Math.sin(angle) : Math.cos(angle);
      output += mode.amplitude * wave * taper;
    }

    // Small, bounded friction gives the sustained tone some surface. Its
    // envelope is movement itself, so there is no idle hiss or fixed buzz.
    let noise = this.noiseState;
    noise ^= noise << 13; noise ^= noise >>> 17; noise ^= noise << 5;
    this.noiseState = noise;
    const white = (noise >>> 0) / 2147483648 - 1;
    this.noiseLow += (white - this.noiseLow) * this.frictionEase;
    output += this.noiseLow * energy * .012;
    return .68 * Math.tanh(output * 1.08);
  }
}
