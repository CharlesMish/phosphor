import {Engine as Catch} from './experiments/catch/engine.mjs';
import {Engine as Slide} from './experiments/slide/engine.mjs';
import {Engine as Bow} from './experiments/bow/engine.mjs';
import {Engine as Resonant} from './experiments/resonant/engine.mjs';

export class StringLabProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engines = {catch: new Catch(sampleRate), slide: new Slide(sampleRate), bow: new Bow(sampleRate), resonant: new Resonant(sampleRate)};
    this.active = null; this.id = null; this.epoch = -1;
    this.fadeLength = Math.max(8, Math.round(sampleRate * .01));
    this.tail = new Float64Array(this.fadeLength);
    this.scratch = new Float64Array(this.fadeLength);
    this.fadeIndex = this.fadeLength;
    this.meterFrames = 0; this.sumSq = 0; this.peak = 0;
    this.port.onmessage = (event) => this.message(event.data);
  }
  sample() {
    const fresh = this.active ? this.active.processSample() : 0;
    if (this.fadeIndex >= this.fadeLength) return Number.isFinite(fresh) ? Math.max(-.9, Math.min(.9, fresh)) : 0;
    const index = this.fadeIndex++;
    const mix = .5 - .5 * Math.cos(Math.PI * index / (this.fadeLength - 1));
    const value = (1 - mix) * this.tail[index] + mix * fresh;
    return Number.isFinite(value) ? Math.max(-.9, Math.min(.9, value)) : 0;
  }
  captureTail() {
    for (let i = 0; i < this.fadeLength; i++) this.scratch[i] = this.sample();
    [this.tail, this.scratch] = [this.scratch, this.tail];
    this.fadeIndex = 0;
  }
  message(message) {
    if (!message || !Number.isInteger(message.epoch) || message.epoch < this.epoch) return;
    try {
      if (message.type === 'select' && Object.hasOwn(this.engines, message.id)) {
        this.captureTail();
        this.active?.command({type: 'stop'});
        this.active = this.engines[message.id]; this.id = message.id; this.epoch = message.epoch;
        this.active.command({type: 'reset'});
        this.resetMeter();
        this.port.postMessage({type: 'selected', id: this.id, epoch: this.epoch});
      } else if (message.type === 'stop') {
        this.captureTail(); this.epoch = message.epoch;
        for (const engine of Object.values(this.engines)) engine.command({type: 'stop'});
        this.resetMeter();
      } else if (message.type === 'command' && message.epoch === this.epoch) {
        if (message.command?.type === 'reset' || message.command?.type === 'stop') this.captureTail();
        this.active?.command(message.command);
      }
    } catch (error) {
      for (const engine of Object.values(this.engines)) engine.command({type: 'stop'});
      this.tail.fill(0); this.fadeIndex = this.fadeLength;
      this.port.postMessage({type: 'error', epoch: this.epoch, message: error?.message || 'Audio command failed'});
    }
  }
  resetMeter() { this.meterFrames = 0; this.sumSq = 0; this.peak = 0; }
  process(_inputs, outputs) {
    const channels = outputs[0];
    if (!channels?.length) return true;
    const output = channels[0];
    for (let i = 0; i < output.length; i++) {
      const value = this.sample();
      output[i] = value;
      this.sumSq += value * value; this.peak = Math.max(this.peak, Math.abs(value)); this.meterFrames++;
    }
    for (let channel = 1; channel < channels.length; channel++) channels[channel].set(output);
    if (this.meterFrames >= sampleRate / 15) {
      const rms = Math.sqrt(this.sumSq / this.meterFrames);
      this.port.postMessage({type: 'meter', epoch: this.epoch, rms, peak: this.peak, active: rms > .0001});
      this.resetMeter();
    }
    return true;
  }
}
registerProcessor('string-lab', StringLabProcessor);
