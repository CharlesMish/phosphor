import { StringVoice } from '../../shared/string-voice.mjs';

const finite = (value, fallback, min, max) => Number.isFinite(value)
  ? Math.max(min, Math.min(max, value)) : fallback;

// Fixed-pitch string. Damping changes the resonator's feedback loss rather than
// its output gain: lifting the damper cannot restore previously absorbed energy.
export class Engine {
  constructor(sampleRate) {
    this.voice = new StringVoice(sampleRate);
    this.decay = 5;
    this.voice.setDecay(this.decay);
  }

  command(event) {
    if (!event || typeof event !== 'object') return;
    switch (event.type) {
      case 'pluck':
        this.voice.pluck({
          frequency: 220,
          position: finite(event.position, 0.38, 0.08, 0.92),
          strength: finite(event.strength, 0.72, 0.05, 1),
          decay: this.decay,
        });
        break;
      case 'damp':
        this.voice.setDamping(finite(event.amount, 0, 0, 1));
        break;
      case 'decay':
        this.decay = finite(event.seconds, 5, 0.4, 8);
        this.voice.setDecay(this.decay);
        break;
      case 'stop':
        this.voice.stop();
        this.voice.setDamping(0);
        break;
      case 'reset':
        this.voice.reset();
        this.decay = 5;
        this.voice.setDecay(this.decay);
        this.voice.setDamping(0);
        break;
    }
  }

  processSample() {
    return this.voice.processSample();
  }
}
