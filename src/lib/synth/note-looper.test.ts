import assert from 'node:assert/strict';
import { it } from 'node:test';
import { PerformanceInput } from './performance.ts';
import { NoteLooper, LOOP_BARS, loopDurationSeconds, type LoopPort } from './note-looper.ts';

function harness() {
  let time = 10;
  let running = true;
  let run = -1;
  const timers = new Set<() => void>();
  const scheduled = new Map<string, { midi: number; start: number; end: number }>();
  const calls: Array<{ midi: number; start: number; end: number }> = [];
  const live = new Set<number>();
  const deadlines: Array<[number, number]> = [];
  const input = new PerformanceInput({
    unlock: () => true, now: () => time,
    noteOn: midi => { live.add(midi); }, noteOff: midi => { live.delete(midi); },
    limitNote: (midi, end) => { deadlines.push([midi, end]); },
  });
  const port: LoopPort = {
    unlock: () => true, now: () => time, running: () => running,
    beginRun: value => { run = value; },
    schedule: (value, id, midi, start, end) => {
      if (value !== run) return;
      scheduled.set(id, { midi, start, end }); calls.push({ midi, start, end });
    },
    cancel: () => { run = -1; scheduled.clear(); }, refresh: () => {},
    interval: fn => { timers.add(fn); return fn; },
    clearInterval: fn => { timers.delete(fn as () => void); },
  };
  const loop = new NoteLooper(port, input, 120);
  const advance = (at: number) => { time = at; [...timers].forEach(fn => fn()); };
  return { loop, input, timers, scheduled, calls, live, deadlines, advance,
    clock: (at: number) => { time = at; }, suspend: () => { running = false; } };
}
for (const bpm of [40, 60, 120, 240]) for (const bars of LOOP_BARS) {
  it(`${bars} bars at ${bpm} BPM has exact 4/4 duration`, () => {
    assert.equal(loopDurationSeconds(bpm, bars), 60 / bpm * 4 * bars);
  });
}
it('idle performance is responsive but never captured', () => {
  const h = harness();
  h.input.noteOn('qwerty:KeyA', 60);
  assert.ok(h.live.has(60));
  h.input.noteOff('qwerty:KeyA');
  assert.equal(h.live.size, 0);
  assert.deepEqual(h.loop.getEvents(), []);
});
it('captures leading silence, ordered unquantized on/off events and both input sources', () => {
  const h = harness(); h.loop.record();
  h.clock(10.137); h.input.noteOn('qwerty:KeyA', 60);
  h.clock(10.431); h.input.noteOff('qwerty:KeyA');
  h.clock(10.7); h.input.noteOn('pointer:1', 64);
  h.clock(10.9); h.input.noteOff('pointer:1');
  const events = h.loop.getEvents();
  assert.deepEqual(events.map(e => [e.type, e.midi]), [['on', 60], ['off', 60], ['on', 64], ['off', 64]]);
  assert.ok(Math.abs(events[0]!.beat - 0.274) < 1e-10);
  assert.ok(Math.abs(events[1]!.beat - 0.862) < 1e-10);
  h.advance(12);
  assert.equal(h.loop.getSnapshot().state, 'playing');
  h.advance(12.05);
  assert.ok(Math.abs(h.calls[0]!.start - 12.137) < 1e-10);
});
it('record boundary clips held notes and stale physical releases cannot affect the loop', () => {
  const h = harness(); h.loop.record();
  h.input.noteOn('qwerty:KeyA', 60);
  assert.deepEqual(h.deadlines, [[60, 12]]);
  h.advance(11.925); // First playback attack queued ahead of the boundary.
  assert.deepEqual(h.calls[0], { midi: 60, start: 12, end: 14 });
  h.advance(12.01);
  assert.deepEqual(h.loop.getEvents().at(-1), { id: 0, midi: 60, type: 'off', beat: 4 });
  assert.equal(h.live.size, 0);
  h.input.noteOff('qwerty:KeyA');
  assert.equal(h.scheduled.size, 1);
});
it('updates a provisionally clipped playback release when key-up occurs just before boundary', () => {
  const h = harness(); h.loop.record(); h.input.noteOn('pointer:1', 60);
  h.advance(11.925);
  h.clock(11.97); h.input.noteOff('pointer:1');
  assert.ok(Math.abs(h.calls.at(-1)!.end - 13.97) < 1e-10);
  h.advance(12);
  assert.equal(h.loop.getEvents().length, 2);
});
it('preserves repeated pitch identities, chords, seam events, and several cycles', () => {
  const h = harness(); h.loop.record();
  h.input.noteOn('qwerty:KeyA', 60); h.input.noteOn('pointer:2', 67);
  h.clock(10.1); h.input.noteOff('qwerty:KeyA'); h.input.noteOff('pointer:2');
  h.clock(11.98); h.input.noteOn('qwerty:KeyA', 60);
  for (let t = 11.9; t < 20.1; t += 0.025) h.advance(t);
  const on = h.loop.getEvents().filter(e => e.type === 'on');
  assert.equal(new Set(on.map(e => e.id)).size, 3);
  assert.equal(h.loop.getEvents().at(-1)!.beat, 4);
  for (const start of [12, 14, 16, 18, 20]) {
    assert.ok(h.calls.some(e => Math.abs(e.start - start) < 1e-8 && e.midi === 60));
    assert.ok(h.calls.some(e => Math.abs(e.start - start) < 1e-8 && e.midi === 67));
  }
  assert.ok(h.calls.some(e => Math.abs(e.start - 13.98) < 1e-8 && e.end === 14));
});
it('same-pitch multi-input ownership records one sounding note and only releases the last owner', () => {
  const h = harness(); h.loop.record();
  h.input.noteOn('qwerty:KeyA', 60); h.input.noteOn('pointer:1', 60);
  h.input.noteOff('qwerty:KeyA'); assert.ok(h.live.has(60));
  h.clock(10.3); h.input.noteOff('pointer:1');
  assert.equal(h.loop.getEvents().length, 2); assert.equal(h.live.size, 0);
});
for (const action of ['stop', 'clear', 'record', 'dispose'] as const) {
  it(`${action} invalidates queued notes and stale timer callbacks`, () => {
    const h = harness(); h.loop.record(); h.input.noteOn('pointer:1', 60);
    h.advance(11.95);
    const oldTick = [...h.timers][0]!;
    h.loop[action]();
    assert.equal(h.scheduled.size, 0); assert.equal(h.live.size, 0);
    const count = h.calls.length;
    h.clock(12); oldTick();
    assert.equal(h.calls.length, count);
    if (action === 'record' || action === 'clear') assert.deepEqual(h.loop.getEvents(), []);
  });
}
it('Stop preserves completed take, Play restarts from beginning, Clear removes it', () => {
  const h = harness(); h.loop.record(); h.input.noteOn('pointer:1', 60);
  h.clock(10.1); h.input.noteOff('pointer:1'); h.advance(12);
  const events = h.loop.getEvents(); h.loop.stop();
  assert.equal(h.loop.getSnapshot().state, 'stopped');
  h.clock(15); h.loop.play();
  assert.deepEqual(h.loop.getEvents(), events);
  assert.equal(h.calls.at(-1)!.start, 15.02);
  h.loop.clear(); assert.equal(h.loop.getSnapshot().hasTake, false);
});
it('BPM change stops playback and preserves beat positions; restart uses new tempo', () => {
  const h = harness(); h.loop.record();
  h.clock(10.5); h.input.noteOn('pointer:1', 60);
  h.clock(11); h.input.noteOff('pointer:1'); h.advance(12);
  const events = h.loop.getEvents(); h.loop.setBpm(60);
  assert.equal(h.loop.getSnapshot().state, 'stopped'); assert.equal(h.scheduled.size, 0);
  assert.deepEqual(h.loop.getEvents(), events);
  h.clock(20); h.loop.play(); h.advance(20.95);
  assert.deepEqual(h.calls.at(-1), { midi: 60, start: 21.02, end: 22.02 });
});
it('BPM change during recording discards partial take, length change clears completed take', () => {
  const h = harness(); h.loop.record(); h.input.noteOn('pointer:1', 60);
  h.loop.setBpm(80); assert.deepEqual(h.loop.getEvents(), []); assert.equal(h.live.size, 0);
  h.loop.record(); h.advance(13); assert.equal(h.loop.getSnapshot().hasTake, true);
  h.loop.setBars(8); assert.equal(h.loop.getSnapshot().hasTake, false);
});
it('no events at or beyond record boundary are added to the take', () => {
  const h = harness(); h.loop.record(); h.clock(12);
  h.input.noteOn('qwerty:KeyA', 60);
  assert.deepEqual(h.loop.getEvents(), []); assert.equal(h.loop.getSnapshot().state, 'playing');
  h.input.noteOff('qwerty:KeyA'); assert.equal(h.live.size, 0);
});
it('suspended clock never advances transport; long stalls skip missed attacks', () => {
  const h = harness(); h.loop.record(); h.input.noteOn('pointer:1', 60);
  h.clock(10.1); h.input.noteOff('pointer:1'); h.advance(12);
  const count = h.calls.length; h.advance(17);
  assert.equal(h.calls.length, count);
  h.suspend(); h.advance(20); assert.equal(h.calls.length, count);
});
it('silent fixed windows remain valid silence rather than inventing notes', () => {
  const h = harness(); h.loop.record(); h.advance(12); h.advance(14);
  assert.equal(h.loop.getSnapshot().state, 'playing'); assert.equal(h.calls.length, 0);
});
for (const bars of LOOP_BARS) {
  it(`${bars}-bar recording transitions at its exact boundary and queues the next cycle`, () => {
    const h = harness(); h.loop.setBars(bars); h.loop.record();
    h.input.noteOn('qwerty:KeyA', 60); h.clock(10.2); h.input.noteOff('qwerty:KeyA');
    const end = 10 + 2 * bars;
    h.advance(end - 0.05); assert.equal(h.loop.getSnapshot().state, 'recording');
    assert.equal(h.calls[0]!.start, end);
    h.advance(end); assert.equal(h.loop.getSnapshot().state, 'playing');
    h.advance(end + 2 * bars - 0.05);
    assert.equal(h.calls.at(-1)!.start, end + 2 * bars);
  });
}
it('changing tempo with an idle looper leaves live playing alone', () => {
  const h = harness(); h.input.noteOn('qwerty:KeyA', 60); h.loop.setBpm(80);
  assert.ok(h.live.has(60)); h.input.noteOff('qwerty:KeyA'); assert.equal(h.live.size, 0);
});
