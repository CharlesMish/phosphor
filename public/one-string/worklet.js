import { StringModel } from './string-model.mjs';

class PluckStringProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.model = new StringModel(sampleRate);
    this.queue = [];
    this.epoch = 0;
    this.blocks = 0;
    this.port.onmessage = (event) => {
      this.queue.push(event.data);
    };
  }

  apply(command) {
    if (!command || typeof command !== 'object') return;
    if (typeof command.epoch === 'number') this.epoch = command.epoch;
    if (command.type === 'stop') {
      this.model.stop();
      return;
    }
    if (command.type === 'decay') {
      this.model.setDecay(command.decay);
      return;
    }
    if (command.type === 'pluck') {
      this.model.pluck({
        frequency: command.frequency,
        position: command.position,
        strength: command.strength,
        decay: command.decay,
      });
    }
  }

  process(_inputs, outputs) {
    const commands = this.queue;
    this.queue = [];
    try {
      for (const command of commands) this.apply(command);
      const channels = outputs[0];
      if (channels && channels[0]) {
        this.model.renderInto(channels[0]);
        for (let c = 1; c < channels.length; c += 1) channels[c].set(channels[0]);
      }
    } catch (error) {
      this.port.postMessage({
        type: 'error',
        message: error && error.message ? error.message : String(error),
        epoch: this.epoch,
      });
      if (outputs[0]) {
        for (const channel of outputs[0]) channel.fill(0);
      }
    }

    this.blocks += 1;
    if (this.blocks % 4 === 0) {
      this.port.postMessage({
        type: 'meter',
        epoch: this.epoch,
        peak: this.model.lastPeak,
        rms: this.model.lastRms,
        active: this.model.lastPeak > 0.0008,
      });
    }
    return true;
  }
}

registerProcessor('pluck-string', PluckStringProcessor);
