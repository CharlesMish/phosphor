import assert from 'node:assert/strict';
import { it } from 'node:test';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';
import { editorPlotInsets } from '../presentation/editor-layout.ts';
import { synth } from './engine.ts';
import { noteLooper } from './looper-runtime.ts';
import { useSynthStore } from './store.ts';

it('mounted keyboard inputs share capture, boundary ownership, tempo and panic cleanup', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const globals = { window: win, document: win.document, Element: win.Element, HTMLElement: win.HTMLElement,
    HTMLInputElement: win.HTMLInputElement, HTMLFormElement: win.HTMLFormElement, Node: win.Node, getComputedStyle: win.getComputedStyle,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  win.HTMLCanvasElement.prototype.getContext = (() => null) as typeof win.HTMLCanvasElement.prototype.getContext;
  win.HTMLElement.prototype.setPointerCapture = () => {};
  win.HTMLElement.prototype.releasePointerCapture = () => {};
  let now = 10;
  const live = new Set<number>();
  const scheduled = new Set<string>();
  const saved = { unlock: synth.unlock, getContext: synth.getContext, noteOn: synth.noteOn, noteOff: synth.noteOff,
    limitLiveNote: synth.limitLiveNote, beginScheduledRun: synth.beginScheduledRun, scheduleNote: synth.scheduleNote,
    cancelScheduledNotes: synth.cancelScheduledNotes, refreshScheduledVoices: synth.refreshScheduledVoices, allNotesOff: synth.allNotesOff };
  Object.assign(synth, {
    unlock: () => true, getContext: () => ({ currentTime: now, state: 'running' }),
    noteOn: (midi: number) => live.add(midi), noteOff: (midi: number) => live.delete(midi),
    limitLiveNote: () => {}, beginScheduledRun: () => {},
    scheduleNote: (_run: number, id: string) => scheduled.add(id),
    cancelScheduledNotes: () => scheduled.clear(), refreshScheduledVoices: () => {},
    allNotesOff: () => { live.clear(); scheduled.clear(); },
  });
  let tick = () => {};
  win.setInterval = ((fn: () => void) => { tick = fn; return 1; }) as typeof win.setInterval;
  win.clearInterval = () => {};
  const { createRoot } = await import('react-dom/client');
  const { PhosphorApp } = await import('../../components/synth/phosphor-app.tsx');
  const { TreatmentProvider } = await import('../presentation/treatment.tsx');
  const errors: unknown[] = [];
  win.addEventListener('error', event => errors.push(event.error));
  const root = createRoot(win.document.getElementById('root')!);
  const key = (target: EventTarget, type: string, code: string) => target.dispatchEvent(new win.KeyboardEvent(type, { code, key: code, bubbles: true }));
  const button = (name: string) => win.document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
  const pointer = (target: EventTarget, type: string, id: number) => {
    const event = new win.Event(type, { bubbles: true }); Object.assign(event, { pointerId: id, clientX: 0, clientY: 0 }); target.dispatchEvent(event);
  };
  try {
    await act(async () => root.render(createElement(TreatmentProvider, null, createElement(PhosphorApp))));
    // Exercise actual captured-pointer handlers outside both canvas edges, plus history.
    const canvas = win.document.querySelector<HTMLCanvasElement>('[aria-label="Draw oscillator waveform"]')!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 300, right: 600, bottom: 300, x: 0, y: 0, toJSON() {} });
    const pad = editorPlotInsets(600, 300);
    const draw = (type: string, phase: number, value: number) => {
      const event = new win.Event(type, { bubbles: true });
      Object.assign(event, { pointerId: 99, clientX: pad.x + phase * (600 - 2 * pad.x), clientY: pad.y + (1 - value) / 2 * (300 - 2 * pad.y) });
      canvas.dispatchEvent(event);
    };
    const baseline = useSynthStore.getState().samples.slice();
    const history = useSynthStore.getState().past.length;
    await act(async () => { draw('pointerdown', 510 / 512, 0.4); draw('pointermove', 1.2, -0.7); draw('pointerup', 1.2, -0.7); });
    assert.deepEqual(useSynthStore.getState().samples.slice(1, 510), baseline.slice(1, 510));
    assert.ok(Math.abs(useSynthStore.getState().samples[0]! + 0.7) < 1e-10);
    assert.equal(useSynthStore.getState().samples.length, 512);
    assert.equal(useSynthStore.getState().past.length, history + 1);
    await act(async () => useSynthStore.getState().undo());
    assert.deepEqual(useSynthStore.getState().samples, baseline);
    await act(async () => { draw('pointerdown', 2 / 512, 0.4); draw('pointermove', -0.2, -0.7); draw('pointerup', -0.2, -0.7); });
    assert.deepEqual(useSynthStore.getState().samples.slice(3), baseline.slice(3));
    await act(async () => useSynthStore.getState().undo());
    await act(async () => {
      button('Record note loop').click();
      now = 10.25; key(win, 'keydown', 'KeyA');
      now = 10.5; key(win, 'keyup', 'KeyA');
      now = 10.75; pointer(button('E4'), 'pointerdown', 1);
      now = 11; pointer(button('E4'), 'pointerup', 1);
    });
    assert.deepEqual(noteLooper.getEvents().map(e => [e.type, e.midi]), [['on', 48], ['off', 48], ['on', 64], ['off', 64]]);
    await act(async () => { now = 12; tick(); });
    assert.equal(noteLooper.getSnapshot().state, 'playing');
    await act(async () => { now = 12.2; tick(); });
    assert.ok(scheduled.size > 0);
    await act(async () => button('Stop note loop').click());
    assert.equal(scheduled.size, 0); assert.equal(live.size, 0);
    const take = noteLooper.getEvents();
    await act(async () => {
      button('Play note loop').click();
      useSynthStore.getState().setMotionRouteEnabled('chorusMix', true);
      useSynthStore.getState().setMotionRouteEnabled('cycle', false);
      useSynthStore.getState().playMotion();
    });
    assert.equal(useSynthStore.getState().motionPlaying, true);
    assert.equal(noteLooper.getSnapshot().state, 'playing');
    await act(async () => { useSynthStore.getState().setMotionBpm(60); });
    assert.equal(useSynthStore.getState().motionPlaying, false);
    assert.equal(noteLooper.getSnapshot().state, 'stopped');
    assert.equal((win.document.querySelector('[aria-label="Shared BPM"]') as HTMLInputElement).value, '60');
    assert.deepEqual(noteLooper.getEvents(), take);
    await act(async () => button('Clear note loop').click());
    assert.equal(noteLooper.getSnapshot().state, 'empty');

    // A brand-new QWERTY press exactly at the boundary must retain its key-up owner.
    await act(async () => {
      useSynthStore.getState().setMotionBpm(120); now = 20; button('Record note loop').click();
      now = 22; key(win, 'keydown', 'KeyA'); key(win, 'keyup', 'KeyA');
    });
    assert.equal(live.size, 0); assert.equal(noteLooper.getEvents().length, 0);
    // Likewise for pointer input; a held pointer is cleared at automatic transition.
    await act(async () => {
      now = 30; button('Record note loop').click(); now = 32;
      pointer(button('E4'), 'pointerdown', 2); pointer(button('E4'), 'pointerup', 2);
    });
    assert.equal(live.size, 0);
    await act(async () => {
      now = 40; button('Record note loop').click(); pointer(button('E4'), 'pointerdown', 3);
      now = 42; tick(); pointer(button('E4'), 'pointerup', 3);
    });
    assert.equal(live.size, 0);
    assert.equal(noteLooper.getEvents().at(-1)!.beat, 4);

    for (const panic of ['Escape', 'blur', 'visibility']) {
      await act(async () => {
        now += 10; button('Record note loop').click(); key(win, 'keydown', 'KeyA');
        if (panic === 'Escape') key(win.document.querySelector('[aria-label="Shared BPM"]')!, 'keydown', 'Escape');
        else if (panic === 'blur') win.dispatchEvent(new win.Event('blur'));
        else {
          Object.defineProperty(win.document, 'hidden', { value: true, configurable: true });
          win.document.dispatchEvent(new win.Event('visibilitychange'));
        }
      });
      assert.equal(noteLooper.getSnapshot().state, 'empty'); assert.equal(live.size, 0); assert.equal(scheduled.size, 0);
    }
    await act(async () => { now += 10; button('Record note loop').click(); key(button('C4'), 'keydown', 'Enter'); });
    assert.equal(noteLooper.getEvents()[0]!.midi, 60);
    await act(async () => root.unmount());
    assert.equal(live.size, 0); assert.equal(scheduled.size, 0);
    assert.deepEqual(errors, []);
  } finally {
    noteLooper.clear(); Object.assign(synth, saved); dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
