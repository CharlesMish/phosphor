// A deliberately synthetic bowed string: movement feeds a bank of harmonic
// modes. This is an expressive exciter/resonator, not a stick-slip violin model.
// Commands: {type:'bow', active:Boolean, speed:0..1, roughness:0..1}, stop, reset.
// Refresh movement at least every 140ms. A lost control stream cannot sustain it.
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
const finite = (x, fallback) => Number.isFinite(x) ? x : fallback;

export class Engine {
  constructor(sampleRate) {
    this.sampleRate = clamp(finite(sampleRate, 48000), 8000, 192000);
    this.frequency = 220;
    this.modes = Array.from({length:10}, (_, i) => {
      const harmonic = i + 1;
      const angle = 2 * Math.PI * this.frequency * harmonic / this.sampleRate;
      return {harmonic, sine:0, cosine:1, sinStep:Math.sin(angle),
        cosStep:Math.cos(angle), amplitude:0,
        rise:1-Math.exp(-1/(this.sampleRate * .065)),
        fall:Math.exp(-1/(this.sampleRate * (.29 + .22 / harmonic)))};
    });
    this.speedEase = 1-Math.exp(-1/(this.sampleRate*.035));
    this.roughEase = 1-Math.exp(-1/(this.sampleRate*.045));
    this.reset();
  }

  reset() {
    this.active = false;
    this.speedTarget = 0;
    this.speed = 0;
    this.roughness = .38;
    this.roughTarget = .38;
    this.age = this.sampleRate;
    this.noiseState = 0x641673;
    this.noiseLow = 0;
    this.noiseEnvelope = 0;
    this.renormalize = 0;
    for (const mode of this.modes) {
      mode.sine = 0; mode.cosine = 1; mode.amplitude = 0;
    }
  }

  command(event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'reset' || event.type === 'stop') {
      this.reset();
    } else if (event.type === 'bow') {
      this.active = event.active === true;
      this.speedTarget = clamp(finite(event.speed, 0), 0, 1);
      this.roughTarget = clamp(finite(event.roughness, this.roughTarget), 0, 1);
      this.age = 0;
    }
  }

  processSample() {
    this.age = Math.min(this.age+1, this.sampleRate);
    const driving = this.active && this.age < this.sampleRate * .14;
    const target = driving ? this.speedTarget : 0;
    this.speed += (target-this.speed) * this.speedEase;
    this.roughness += (this.roughTarget-this.roughness)*this.roughEase;
    // A broad middle range, rather than a velocity switch. A noise floor is not
    // added to speed: complete stillness supplies exactly zero energy.
    const energy = Math.pow(this.speed, .72);
    let sample = 0;
    for (const mode of this.modes) {
      const k = mode.harmonic;
      const weight = 1 / Math.pow(k, 1.9 - this.roughness * 1.03);
      // Small alternating emphasis avoids a sterile pure sawtooth character.
      const texture = k % 2 ? 1 : .70 + .20*this.roughness;
      const wanted = .40 * energy * weight * texture;
      if (wanted > mode.amplitude) {
        mode.amplitude += (wanted-mode.amplitude) * mode.rise;
      } else {
        mode.amplitude = wanted + (mode.amplitude-wanted)*mode.fall;
      }
      const sine = mode.sine * mode.cosStep + mode.cosine * mode.sinStep;
      mode.cosine = mode.cosine * mode.cosStep - mode.sine * mode.sinStep;
      mode.sine = sine;
      // Harmonics alternate phase for a full, slightly nasal string voice.
      sample += mode.amplitude * (k % 2 ? mode.sine : mode.cosine);
    }
    // Bounded deterministic friction noise, heard mainly at the rough end.
    let n = this.noiseState;
    n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
    this.noiseState = n;
    const noise = (n >>> 0) / 2147483648 - 1;
    this.noiseLow += .20 * (noise-this.noiseLow);
    this.noiseEnvelope += (energy-this.noiseEnvelope) * this.speedEase;
    sample += this.noiseLow * this.noiseEnvelope * this.roughness**2 * .11;
    if (++this.renormalize === 2048) {
      this.renormalize = 0;
      for (const mode of this.modes) {
        const length = Math.hypot(mode.sine, mode.cosine);
        mode.sine /= length; mode.cosine /= length;
      }
    }
    return .63 * Math.tanh(sample * 1.12);
  }
}
