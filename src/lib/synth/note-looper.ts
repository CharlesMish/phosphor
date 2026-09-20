import { beatDurationSeconds, clampMotionBpm } from './motion';
import type { PerformanceEvent, PerformanceInput } from './performance';

export const LOOP_BARS = [1, 2, 4, 8] as const;
export type LoopBars = typeof LOOP_BARS[number];
export const LOOP_LOOKAHEAD = 0.1;
export const LOOP_TICK_MS = 25;
export function loopDurationSeconds(bpm: number, bars: LoopBars) {
  return beatDurationSeconds(bpm) * 4 * bars;
}
export type NoteEvent = { id: number; type: 'on' | 'off'; midi: number; beat: number };
export type LoopSnapshot = {
  state: 'empty' | 'recording' | 'playing' | 'stopped';
  bars: LoopBars; progress: number; eventCount: number; hasTake: boolean;
};
export type LoopPort = {
  unlock(): boolean;
  now(): number;
  running(): boolean;
  beginRun(run: number): void;
  schedule(run: number, id: string, midi: number, start: number, end: number): void;
  cancel(): void;
  refresh(): void;
  interval(fn: () => void, ms: number): unknown;
  clearInterval(timer: unknown): void;
};

/** Fixed-window note transport. The timer fills an audio-clock queue, never plays notes. */
export class NoteLooper {
  private events: NoteEvent[] = [];
  private active = new Map<number, number>();
  private nextId = 0;
  private run = 0;
  private timer: unknown = null;
  private origin = 0;
  private recordEnd = 0;
  private bpm: number;
  private scheduled = new Map<string, number>();
  private listeners = new Set<() => void>();
  private unsubscribe: () => void;
  private snapshot: LoopSnapshot = { state: 'empty', bars: 1, progress: 0, eventCount: 0, hasTake: false };
  private port: LoopPort;
  private input: PerformanceInput;
  constructor(port: LoopPort, input: PerformanceInput, bpm: number) {
    this.port = port;
    this.input = input;
    this.bpm = clampMotionBpm(bpm);
    this.unsubscribe = input.subscribe(event => this.capture(event));
  }
  getSnapshot = () => this.snapshot;
  getEvents() { return this.events.map(e => ({ ...e })); }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  private update(patch: Partial<LoopSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(fn => fn());
  }
  setBars(bars: LoopBars) {
    if (!LOOP_BARS.includes(bars) || bars === this.snapshot.bars) return;
    // A take's bar window is immutable. Choosing another length creates an empty take.
    this.clear();
    this.update({ bars });
  }
  setBpm(bpm: number) {
    const next = clampMotionBpm(bpm);
    if (next === this.bpm) return;
    if (this.snapshot.state === 'recording' || this.snapshot.state === 'playing') this.stop();
    this.bpm = next;
  }
  record() {
    this.clear();
    if (!this.port.unlock()) return;
    this.origin = this.port.now();
    this.recordEnd = this.origin + loopDurationSeconds(this.bpm, this.snapshot.bars);
    this.input.setDeadline(this.recordEnd);
    this.update({ state: 'recording' });
    this.startTimer();
  }
  play() {
    if (!this.snapshot.hasTake || !this.port.unlock()) return;
    this.stop();
    this.origin = this.port.now() + 0.02;
    this.update({ state: 'playing', progress: 0 });
    this.startTimer();
  }
  stop() {
    this.run++;
    if (this.timer !== null) this.port.clearInterval(this.timer);
    this.timer = null;
    this.port.cancel();
    this.input.reset();
    this.active.clear();
    this.scheduled.clear();
    if (this.snapshot.state === 'recording') this.events = [];
    this.update({ state: this.snapshot.hasTake ? 'stopped' : 'empty', progress: 0, eventCount: this.events.length });
  }
  clear() {
    this.stop();
    this.events = [];
    this.nextId = 0;
    this.update({ state: 'empty', hasTake: false, eventCount: 0 });
  }
  dispose() { this.stop(); this.unsubscribe(); }
  private startTimer() {
    const run = ++this.run;
    this.port.beginRun(run);
    this.timer = this.port.interval(() => this.tick(run), LOOP_TICK_MS);
    this.tick(run);
  }
  private capture(event: PerformanceEvent) {
    if (this.snapshot.state !== 'recording') return;
    if (event.time >= this.recordEnd) { this.tick(this.run); return; }
    const beat = Math.max(0, (event.time - this.origin) / beatDurationSeconds(this.bpm));
    if (event.type === 'on') {
      if (this.active.has(event.midi)) return;
      const id = this.nextId++;
      this.active.set(event.midi, id);
      this.events.push({ id, midi: event.midi, type: 'on', beat });
    } else {
      const id = this.active.get(event.midi);
      if (id === undefined) return;
      this.active.delete(event.midi);
      this.events.push({ id, midi: event.midi, type: 'off', beat });
    }
    this.update({ eventCount: this.events.length });
    // Also updates a provisional release queued in the final 100 ms of recording.
    this.tick(this.run);
  }
  private notes() {
    const ends = new Map(this.events.filter(e => e.type === 'off').map(e => [e.id, e.beat]));
    return this.events.filter(e => e.type === 'on').map(e => ({
      ...e, end: ends.get(e.id) ?? this.snapshot.bars * 4,
    }));
  }
  private tick(run: number) {
    if (run !== this.run || !['recording', 'playing'].includes(this.snapshot.state)) return;
    // A suspended audio clock cannot advance the transport. Visibility panic stops it.
    if (!this.port.running()) return;
    const now = this.port.now();
    const duration = loopDurationSeconds(this.bpm, this.snapshot.bars);
    if (this.snapshot.state === 'recording' && now >= this.recordEnd) {
      for (const [midi, id] of this.active) this.events.push({ id, midi, type: 'off', beat: this.snapshot.bars * 4 });
      this.active.clear();
      this.input.reset();
      this.origin = this.recordEnd;
      this.update({ state: 'playing', hasTake: true, eventCount: this.events.length });
    }
    const recording = this.snapshot.state === 'recording';
    const playbackOrigin = recording ? this.recordEnd : this.origin;
    const cycle = Math.max(0, Math.floor((now - playbackOrigin) / duration));
    // Long main-thread stalls skip missed attacks rather than bursting old notes.
    for (const [id, at] of this.scheduled) if (at < now - duration) this.scheduled.delete(id);
    for (let lap = cycle; lap <= cycle + 1; lap++) {
      for (const note of this.notes()) {
        const start = playbackOrigin + lap * duration + note.beat * beatDurationSeconds(this.bpm);
        const end = playbackOrigin + lap * duration + note.end * beatDurationSeconds(this.bpm);
        const id = `${run}:${lap}:${note.id}`;
        if (start > now + LOOP_LOOKAHEAD || end <= start) continue;
        if (!this.scheduled.has(id) && start < now - LOOP_TICK_MS / 1000) continue;
        if (this.scheduled.get(id) === end) continue;
        this.port.schedule(run, id, note.midi, start, end);
        this.scheduled.set(id, end);
      }
    }
    this.port.refresh();
    this.update({ progress: recording ? Math.min(1, (now - this.origin) / duration)
      : Math.max(0, (now - this.origin) / duration) % 1 });
  }
}
