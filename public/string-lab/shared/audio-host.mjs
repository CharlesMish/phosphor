/** One context and one processor. Epochs reject stale controls after Stop/switch. */
const IDS = new Set(['catch', 'slide', 'bow', 'resonant', 'ribbon']);
const noop = () => {};
export class AudioHost {
  constructor({onState = noop, onMeter = noop, onError = noop} = {}) {
    this.onState = onState; this.onMeter = onMeter; this.onError = onError;
    this.state = 'off'; this.selected = 'catch';
    this.context = null; this.node = null;
    this._generation = 0; this._epoch = 0; this._selectedEpoch = -1;
    this._enablePromise = null; this._pendingSelection = null; this._disposed = false;
  }
  get ready() {
    return !this._disposed && this.state === 'on' && this.context?.state === 'running' && !!this.node && this._selectedEpoch === this._epoch;
  }
  _state(state) { if (this.state !== state) { this.state = state; this.onState(state); } }
  _settleSelection(value = false) {
    if (!this._pendingSelection) return;
    const pending = this._pendingSelection; this._pendingSelection = null;
    clearTimeout(pending.timer); pending.resolve(value);
  }
  _detach() {
    this._settleSelection(false); this._selectedEpoch = -1;
    const node = this.node; const ctx = this.context;
    this.node = null; this.context = null;
    if (node) { node.port.onmessage = null; node.onprocessorerror = null; node.disconnect(); node.port.close?.(); }
    if (ctx) { ctx.onstatechange = null; if (ctx.state !== 'closed') return Promise.resolve(ctx.close()).catch(noop); }
    return Promise.resolve();
  }
  _message(event) {
    const message = event.data;
    if (!message || message.epoch !== this._epoch) return;
    if (message.type === 'selected' && message.id === this.selected) {
      this._selectedEpoch = message.epoch;
      if (this.context?.state === 'running') this._state('on');
      this._settleSelection(true);
    } else if (message.type === 'meter') {
      this.onMeter({rms: message.rms, peak: message.peak, active: message.active});
    } else if (message.type === 'error') {
      this._fail(new Error(message.message || 'The audio processor stopped. Please enable audio again.'));
    }
  }
  _fail(error) {
    this._generation++; this._enablePromise = null;
    this._detach(); this._state('error'); this.onError(error);
  }
  _selectNow() {
    this._settleSelection(false);
    this._selectedEpoch = -1;
    const epoch = this._epoch;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pendingSelection?.epoch !== epoch) return;
        this._pendingSelection = null;
        const error = new Error('Audio did not become ready. Try enabling it again.');
        this._fail(error); reject(error);
      }, 5000);
      this._pendingSelection = {epoch, resolve, timer};
      this.node.port.postMessage({type: 'select', id: this.selected, epoch});
    });
    this._selectionPromise = promise;
    return promise;
  }
  async enable() {
    if (this._disposed) return false;
    if (this.ready) return true;
    if (this._enablePromise) return this._enablePromise;
    const generation = ++this._generation;
    this._state('starting');
    // Invoke resume synchronously within the initiating gesture, before module awaits.
    const promise = (async () => {
      try {
        if (!this.context || this.context.state === 'closed') {
          const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
          if (!Context) throw new Error('This browser does not support Web Audio.');
          const ctx = new Context({latencyHint: 'interactive'});
          this.context = ctx;
          ctx.onstatechange = () => {
            if (this.context !== ctx) return;
            if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
              if (this.state !== 'starting') {
                // Queue a clear while paused; interrupted audio must not resume a held bow.
                this.stop(); this._state('suspended');
              }
            } else if (ctx.state === 'running' && this._selectedEpoch === this._epoch && this.node) {
              this._state('on');
            }
          };
          const resume = ctx.resume();
          // Promise.all observes both failures (including a rejected gesture resume).
          await Promise.all([resume, ctx.audioWorklet.addModule(new URL('../worklet.mjs', import.meta.url))]);
          if (generation !== this._generation || this.context !== ctx) return false;
          const node = new AudioWorkletNode(ctx, 'string-lab', {numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1]});
          this.node = node;
          node.port.onmessage = (event) => { if (this.node === node) this._message(event); };
          node.onprocessorerror = () => { if (this.node === node) this._fail(new Error('Audio processor interrupted. Try enabling it again.')); };
          node.connect(ctx.destination);
        } else {
          await this.context.resume();
          if (generation !== this._generation) return false;
        }
        if (this.context.state !== 'running') throw new Error('Audio is paused. Tap Enable audio to retry.');
        let selection = this._selectNow();
        await selection;
        while (generation === this._generation && !this.ready && this._selectionPromise !== selection) {
          selection = this._selectionPromise; await selection;
        }
        if (generation !== this._generation) return false;
        return this.ready;
      } catch (error) {
        if (generation !== this._generation) return false;
        this._fail(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    })();
    this._enablePromise = promise;
    try { return await promise; }
    finally { if (this._enablePromise === promise) this._enablePromise = null; }
  }
  async select(id) {
    if (!IDS.has(id)) throw new Error(`Unknown experiment: ${id}`);
    if (this._disposed) return false;
    if (id === this.selected && this.ready) return true;
    this.selected = id; this._epoch++; this._selectedEpoch = -1;
    if (this.node && this.context?.state === 'running') return this._selectNow();
    if (this._enablePromise) { await this._enablePromise; return this.ready && this.selected === id; }
    return true;
  }
  send(command) {
    if (!this.ready || !command || typeof command !== 'object') return false;
    this.node.port.postMessage({type: 'command', command, epoch: this._epoch});
    return true;
  }
  stop() {
    this._epoch++;
    this._settleSelection(false);
    this.onMeter({rms: 0, peak: 0, active: false});
    if (this._enablePromise && this.state === 'starting') {
      this._generation++; this._enablePromise = null;
      this._detach(); this._state('off'); return;
    }
    if (this.node) {
      this.node.port.postMessage({type: 'stop', epoch: this._epoch});
      this._selectedEpoch = this._epoch;
      if (this.context?.state === 'running') this._state('on');
    }
  }
  async suspend() {
    if (this._disposed) return;
    if (this.state === 'starting' || (this._enablePromise && !this.node)) {
      this._generation++; this._enablePromise = null;
      await this._detach(); this._state('suspended'); return;
    }
    this.stop();
    const ctx = this.context;
    if (ctx && ctx.state !== 'closed') await ctx.suspend();
    if (this.context === ctx) this._state('suspended');
  }
  async dispose() {
    if (this._disposed) return;
    this._disposed = true; this._generation++; this._enablePromise = null;
    await this._detach(); this._state('off'); this.onMeter({rms: 0, peak: 0, active: false});
  }
}
