/** One authenticated live-performance stream for pointer, focused-key and QWERTY input. */
export type PerformanceEvent = { type: 'on' | 'off'; midi: number; time: number };
export type PerformancePort = {
  unlock(): boolean;
  now(): number;
  noteOn(midi: number): void;
  noteOff(midi: number): void;
  limitNote(midi: number, end: number): void;
};
export class PerformanceInput {
  private held = new Map<string, number>();
  private listeners = new Set<(event: PerformanceEvent) => void>();
  private resetListeners = new Set<() => void>();
  private deadline: number | null = null;
  private port: PerformancePort;
  constructor(port: PerformancePort) { this.port = port; }
  subscribe(fn: (event: PerformanceEvent) => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  onReset(fn: () => void) {
    this.resetListeners.add(fn);
    return () => { this.resetListeners.delete(fn); };
  }
  setDeadline(end: number | null) { this.deadline = end; }
  noteOn(owner: string, midi: number) {
    if (this.held.has(owner) || !this.port.unlock()) return;
    const alreadyHeld = [...this.held.values()].includes(midi);
    this.held.set(owner, midi);
    if (alreadyHeld) return;
    const time = this.port.now();
    // Capture first: a boundary transition can reset ownership before this new press.
    this.listeners.forEach(fn => fn({ type: 'on', midi, time }));
    this.held.set(owner, midi);
    this.port.noteOn(midi);
    if (this.deadline !== null && time < this.deadline) this.port.limitNote(midi, this.deadline);
  }
  noteOff(owner: string) {
    const midi = this.held.get(owner);
    if (midi === undefined) return;
    this.held.delete(owner);
    if ([...this.held.values()].includes(midi)) return;
    this.listeners.forEach(fn => fn({ type: 'off', midi, time: this.port.now() }));
    this.port.noteOff(midi);
  }
  /** Transport boundaries invalidate old physical ownership; stale key-ups become no-ops. */
  reset() {
    this.deadline = null;
    for (const midi of new Set(this.held.values())) this.port.noteOff(midi);
    this.held.clear();
    this.resetListeners.forEach(fn => fn());
  }
}
