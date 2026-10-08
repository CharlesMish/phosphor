import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioHost } from '../../public/string-lab/shared/audio-host.mjs';
import { mount, demo } from '../../public/string-lab/experiments/ribbon/view.mjs';

const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
const render = (processor, seconds, rate) => {
  const samples = new Float64Array(Math.round(seconds * rate));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = processor.sample();
    assert.ok(Number.isFinite(samples[i]) && Math.abs(samples[i]) <= .9, `invalid output at ${i}`);
  }
  return samples;
};
let Processor;
async function makeProcessor(rate) {
  globalThis.sampleRate = rate;
  globalThis.AudioWorkletProcessor = class {
    constructor() { this.port = { messages: [], postMessage(message) { this.messages.push(message); } }; }
  };
  globalThis.registerProcessor = () => {};
  if (!Processor) ({ StringLabProcessor: Processor } = await import('../../public/string-lab/worklet.mjs'));
  return new Processor();
}

test('Bowed Slide can be selected through the shared audio host before enabling audio', async () => {
  const host = new AudioHost();
  assert.equal(await host.select('ribbon'), true);
  assert.equal(host.selected, 'ribbon');
  assert.equal(host.ready, false);
  await host.dispose();
});

for (const rate of [44100, 48000]) {
  test(`Bowed Slide routes through worklet, rejects stale bowing and accepts a new gesture after Stop at ${rate}`, async () => {
    const processor = await makeProcessor(rate);
    processor.message({ type: 'select', id: 'ribbon', epoch: 1 });
    assert.equal(processor.id, 'ribbon');
    assert.equal(processor.port.messages.at(-1).type, 'selected');
    assert.equal(rms(render(processor, .05, rate)), 0, 'selection starts silently');
    let driven;
    for (let i = 0; i < 10; i++) {
      processor.message({ type: 'command', epoch: 1, command: { type: 'bow', active: true, speed: .6, midi: 57 + i } });
      driven = render(processor, .05, rate);
    }
    assert.ok(rms(driven) > .02, 'sustained bow commands reach the new engine');

    processor.message({ type: 'stop', epoch: 2 });
    processor.message({ type: 'command', epoch: 1, command: { type: 'bow', active: true, speed: 1, midi: 69 } });
    const stopped = render(processor, .1, rate);
    assert.equal(rms(stopped.subarray(processor.fadeLength)), 0, 'late bow commands cannot restart a stopped voice');
    processor.message({ type: 'command', epoch: 2, command: { type: 'bow', active: true, speed: .7, midi: 60 } });
    assert.ok(rms(render(processor, .1, rate)) > .01, 'real input can immediately replace a stopped demo');

    processor.message({ type: 'select', id: 'slide', epoch: 3 });
    processor.message({ type: 'command', epoch: 2, command: { type: 'bow', active: true, speed: 1, midi: 69 } });
    const switched = render(processor, .1, rate);
    assert.equal(rms(switched.subarray(processor.fadeLength)), 0, 'switching modes clears the held bow and its stale commands');
    processor.message({ type: 'command', epoch: 3, command: { type: 'pluck', midi: 57, strength: .7, decay: 4 } });
    assert.ok(rms(render(processor, .1, rate)) > .01, 'the original Slide still plays after the combined mode');
  });

  test(`Bowed Slide's real demo feeds the watchdog and ends at rest at ${rate}`, async () => {
    const processor = await makeProcessor(rate);
    processor.message({ type: 'select', id: 'ribbon', epoch: 1 });
    const controls = demo.events.filter(event => event.command);
    for (let i = 1; i < controls.length; i++) {
      if (controls[i - 1].command.active && controls[i - 1].command.speed > 0) {
        assert.ok(controls[i].at - controls[i - 1].at < .14, 'sustained demo strokes refresh before the watchdog expires');
      }
    }
    const last = controls.at(-1).command;
    assert.ok(!last.active || last.speed === 0, 'the demo explicitly ends excitation');
    let next = 0, peak = 0, finalEnergy = 0, finalCount = 0;
    for (let i = 0; i < Math.round(demo.duration * rate); i++) {
      while (next < demo.events.length && demo.events[next].at <= i / rate) {
        const event = demo.events[next++];
        if (event.command) processor.message({ type: 'command', epoch: 1, command: event.command });
      }
      const value = processor.sample();
      assert.ok(Number.isFinite(value) && Math.abs(value) <= .9);
      peak = Math.max(peak, Math.abs(value));
      if (i > (demo.duration - .3) * rate) { finalEnergy += value * value; finalCount++; }
    }
    assert.ok(peak > .1, 'demo produces a real sustained tone');
    assert.ok(Math.sqrt(finalEnergy / finalCount) < .00001, 'rest at the end becomes practically silent');
  });
}

// Exercise production event handlers without a browser or a duplicate gesture
// implementation. The fake elements only provide event/capture/style plumbing.
function mountHarness(width = 800) {
  const prior = Object.fromEntries(['performance', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let now = 0, nextFrame = 0, interactions = 0;
  const frames = new Map(), elements = new Map(), commands = [];
  class Element {
    constructor() { this.listeners = new Map(); this.captured = new Set(); this.style = {}; this.attributes = {}; this.checked = true; this.classList = { toggle() {} }; }
    addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
    emit(type, event = {}) { for (const handler of this.listeners.get(type) || []) handler({ preventDefault() {}, repeat: false, button: 0, pointerType: 'mouse', pointerId: 1, ...event }); }
    setAttribute(name, value) { this.attributes[name] = value; }
    getBoundingClientRect() { return { left: 20, top: 30, width, height: 340 }; }
    setPointerCapture(id) { this.captured.add(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    releasePointerCapture(id) { this.captured.delete(id); this.emit('lostpointercapture', { pointerId: id }); }
    focus() {}
  }
  const container = { innerHTML: '', querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); } };
  const globals = { performance: { now: () => now }, matchMedia: () => ({ matches: true }), requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id) };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let view;
  view = mount(container, { ready: () => true, send: command => { commands.push(command); return true; }, interact: () => { interactions++; view?.demoFrame(null); }, hint() {}, meter: () => ({ rms: 0, active: false }) });
  const surface = elements.get('#ribbon-surface');
  return {
    view, commands, surface, elements,
    get interactions() { return interactions; },
    advance(ms) { now += ms; },
    frame(ms = 20) { now += ms; const queued = [...frames.values()]; frames.clear(); for (const callback of queued) callback(now); },
    pointer(type, x, y) { surface.emit(type, { clientX: 20 + x * width, clientY: 30 + y * 340 }); },
    key(type, key, repeat = false) { surface.emit(type, { key, repeat }); },
    close() { view.dispose(); for (const [key, descriptor] of Object.entries(prior)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } },
  };
}

test('Bowed Slide keeps horizontal movement silent, including after an earlier stroke has rested', () => {
  const h = mountHarness();
  try {
    h.pointer('pointerdown', .3, .3);
    assert.equal(h.commands.at(-1).speed, 0, 'contact alone is silent');
    h.advance(40); h.pointer('pointermove', .6, .3);
    assert.equal(h.commands.at(-1).speed, 0, 'pitch alone is silent');
    h.advance(40); h.pointer('pointermove', .6, .5);
    assert.ok(h.commands.at(-1).speed > .1, 'vertical movement feeds energy');
    h.frame(200);
    assert.equal(h.commands.at(-1).speed, 0, 'held still reaches zero excitation');
    h.advance(40); h.pointer('pointermove', .4, .5);
    assert.equal(h.commands.at(-1).speed, 0, 'new horizontal travel cannot revive old bow speed');
  } finally { h.close(); }
});

test('Bowed Slide ends bow energy when its last bow key lifts, even while a pitch key remains', () => {
  const h = mountHarness();
  try {
    h.key('keydown', 'ArrowUp'); h.key('keydown', 'ArrowRight'); h.frame(40);
    assert.ok(h.commands.at(-1).speed > 0);
    const before = h.commands.at(-1).midi;
    h.key('keyup', 'ArrowUp'); h.frame(40);
    assert.equal(h.commands.at(-1).speed, 0);
    assert.ok(h.commands.at(-1).midi > before, 'remaining pitch key can still shape the tail');
    h.key('keyup', 'ArrowRight');
    assert.equal(h.commands.at(-1).active, false);
  } finally { h.close(); }
});

test('Bowed Slide ignores orphan key repeats after Stop until a fresh key press', () => {
  const h = mountHarness();
  try {
    h.key('keydown', 'ArrowDown'); h.frame(); h.view.cancel();
    h.commands.length = 0;
    h.key('keydown', 'ArrowDown', true); h.frame(50);
    assert.ok(h.commands.every(command => command.speed === 0), 'Stop cannot be undone by autorepeat from a cancelled held key');
    h.key('keyup', 'ArrowDown'); h.key('keydown', 'ArrowDown');
    assert.ok(h.commands.at(-1).speed > 0, 'a deliberate new press still plays');
  } finally { h.close(); }
});

test('Clearing demo visuals preserves a real captured gesture and cancellation releases it', () => {
  const h = mountHarness();
  try {
    h.view.demoFrame({ midi: 69, speed: .8, contact: true });
    h.pointer('pointerdown', .5, .3);
    assert.equal(h.interactions, 1, 'real input announces demo cancellation');
    h.view.demoFrame(null);
    h.advance(40); h.pointer('pointermove', .5, .5); h.frame();
    assert.ok(h.commands.at(-1).speed > 0, 'incoming real stroke survives demo visual cleanup');
    assert.equal(h.surface.hasPointerCapture(1), true);
    h.view.cancel();
    assert.equal(h.surface.hasPointerCapture(1), false);
    h.commands.length = 0; h.frame(50);
    assert.equal(h.commands.length, 0, 'cancelled input cannot keep refreshing excitation');
  } finally { h.close(); }
});

test('Bowed Slide uses the same pitch and movement coordinates on narrow and wide surfaces', () => {
  const gestures = [];
  for (const width of [300, 1000]) {
    const h = mountHarness(width);
    try {
      h.elements.get('#ribbon-snap').checked = false;
      h.pointer('pointerdown', .05, .25);
      const low = h.commands.at(-1).midi;
      h.advance(40); h.pointer('pointermove', .95, .45); h.frame();
      gestures.push({ low, high: h.commands.at(-1).midi, speed: h.commands.at(-1).speed, marker: h.elements.get('#ribbon-pin').style.left });
    } finally { h.close(); }
  }
  assert.deepEqual(gestures[0], gestures[1]);
  assert.equal(gestures[0].low, 57);
  assert.ok(Math.abs(gestures[0].high - 69) < 1e-12);
  assert.equal(gestures[0].marker, '95%');
});
