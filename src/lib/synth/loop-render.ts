import { SynthEngine } from "./engine";
import { motionFrameAtTime } from "./motion";
import { hasPlayableMotionRoute, mapMotionRoute } from "./motion-routing";
import { LOOP_LOOKAHEAD, LOOP_TICK_MS, loopDurationSeconds, type LoopBars, type NoteEvent } from "./note-looper";
import type { SoundSnapshot } from "./sound-file";

export const RENDER_SAMPLE_RATE = 48000;
export const RENDER_FORMAT = "phosphor-render";
export const RENDER_VERSION = 1;
/** Matches the live Motion controller's 30 Hz frame rate. */
export const MOTION_FRAME_SECONDS = 1 / 30;
/** Allowance after the last release for the chorus delay and filter ring-out. */
export const RENDER_TAIL_MARGIN = 0.1;
/** How far a seamless render runs into the pass after the kept one. */
export const SEAMLESS_GUARD_SECONDS = 0.25;

/**
 * - `take`: the take once, plus its natural release and Space tail.
 * - `seamless`: exactly one loop long. Earlier passes are rendered and dropped, so
 *   tails from the end of the loop are already present at its start, as they are
 *   when the loop repeats live. The file can be looped without a gap.
 */
export type RenderMode = "take" | "seamless";

export type TakeNote = { id: number; midi: number; start: number; end: number };

export type RenderPlan = {
  loopSeconds: number;
  tailSeconds: number;
  passes: number;
  renderSeconds: number;
  keepFromSeconds: number;
  keepSeconds: number;
};

/** Pairs note-on/off events exactly as the live looper does, in seconds. */
export function takeNotes(events: NoteEvent[], bars: LoopBars, bpm: number): TakeNote[] {
  const beat = loopDurationSeconds(bpm, bars) / (bars * 4);
  const ends = new Map(events.filter((e) => e.type === "off").map((e) => [e.id, e.beat]));
  return events
    .filter((e) => e.type === "on")
    .map((e) => ({ id: e.id, midi: e.midi, start: e.beat * beat, end: (ends.get(e.id) ?? bars * 4) * beat }))
    .filter((n) => n.end > n.start);
}

export function tailSeconds(sound: SoundSnapshot): number {
  return sound.voice.release + (sound.space.mix > 0 ? sound.space.seconds : 0) + RENDER_TAIL_MARGIN;
}

export function planRender(sound: SoundSnapshot, bars: LoopBars, bpm: number, mode: RenderMode): RenderPlan {
  const loopSeconds = loopDurationSeconds(bpm, bars);
  const tail = tailSeconds(sound);
  if (mode === "take") {
    return {
      loopSeconds,
      tailSeconds: tail,
      passes: 1,
      renderSeconds: loopSeconds + tail,
      keepFromSeconds: 0,
      keepSeconds: loopSeconds + tail,
    };
  }
  // Earlier passes let every tail wrap into the kept one. The render also runs
  // a short way into the following pass: live, the next loop's first notes are
  // scheduled 100 ms early and rebalance the voice gain under the bar line, so a
  // final pass with nothing after it would not match the loop as it repeats.
  const wrapPasses = Math.max(1, Math.ceil(tail / loopSeconds));
  return {
    loopSeconds,
    tailSeconds: tail,
    passes: wrapPasses + 2,
    renderSeconds: (wrapPasses + 1) * loopSeconds + SEAMLESS_GUARD_SECONDS,
    keepFromSeconds: wrapPasses * loopSeconds,
    keepSeconds: loopSeconds,
  };
}

/** Would a seamless file also loop Motion cleanly? True when Motion is periodic with the loop. */
export function motionLoopsWithTake(sound: SoundSnapshot, bars: LoopBars): boolean {
  const { mode, beats } = sound.motion;
  if (mode === "one-shot") return false;
  return (bars * 4) % beats === 0;
}

export type RenderRequest = {
  sound: SoundSnapshot;
  events: NoteEvent[];
  bars: LoopBars;
  mode: RenderMode;
  /** Run Motion from the start of the render, as if Play was pressed at bar 1. */
  includeMotion: boolean;
  sampleRate?: number;
  /** Seamless only: extra passes before the kept one (QA compares later passes). */
  extraPasses?: number;
  /** Injectable for tests and the QA page. */
  createContext?: (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
};

export type RenderResult = {
  channels: Float32Array[];
  sampleRate: number;
  plan: RenderPlan;
  peak: number;
  notes: number;
  motion: boolean;
  provenance: Record<string, unknown>;
};

function configure(engine: SynthEngine, sound: SoundSnapshot) {
  engine.setParams({ ...sound.voice });
  engine.setDriveState(sound.drive.curve.slice(), sound.drive.amount, sound.drive.safe);
  engine.setChorusCurve(sound.chorus.curve.slice());
  engine.setChorusPeriod(sound.chorus.period);
  engine.setChorusMix(sound.chorus.mix);
  engine.setSpace(sound.space.contour.slice(), sound.space.seed, sound.space.metal, sound.space.seconds);
  engine.setSpaceMix(sound.space.mix);
  const { slotA, slotB, morph, morphLive, samples } = sound.cycle;
  if (morphLive && slotA && slotB) engine.setCycleMorph(slotA.slice(), slotB.slice(), morph);
  else engine.setWaveform(samples.slice(), true);
}

/** Applies one Motion value to every enabled destination, as the store does live. */
function applyMotion(engine: SynthEngine, sound: SoundSnapshot, value: number) {
  const { routes } = sound.motion;
  const { slotA, slotB } = sound.cycle;
  if (routes.cycle.enabled && slotA && slotB) {
    engine.setCycleMorph(slotA, slotB, routes.cycle.inverted ? 1 - value : value);
  }
  if (routes.driveAmount.enabled) {
    engine.setDriveState(sound.drive.curve, mapMotionRoute("driveAmount", routes.driveAmount, value), sound.drive.safe);
  }
  if (routes.chorusMix.enabled) engine.setChorusMix(mapMotionRoute("chorusMix", routes.chorusMix, value));
  if (routes.spaceMix.enabled) engine.setSpaceMix(mapMotionRoute("spaceMix", routes.spaceMix, value));
}

export async function renderTake(request: RenderRequest): Promise<RenderResult> {
  const { sound, events, bars, mode } = request;
  const sampleRate = request.sampleRate ?? RENDER_SAMPLE_RATE;
  const bpm = sound.motion.bpm;
  let plan = planRender(sound, bars, bpm, mode);
  const extra = mode === "seamless" ? Math.max(0, Math.floor(request.extraPasses ?? 0)) : 0;
  if (extra) {
    const shift = extra * plan.loopSeconds;
    plan = { ...plan, passes: plan.passes + extra, renderSeconds: plan.renderSeconds + shift, keepFromSeconds: plan.keepFromSeconds + shift };
  }
  const once = takeNotes(events, bars, bpm);
  if (once.length === 0) throw new Error("The take has no notes to render.");
  const notes = Array.from({ length: plan.passes }, (_, lap) =>
    once.map((n) => ({ ...n, key: `${lap}:${n.id}`, start: n.start + lap * plan.loopSeconds, end: n.end + lap * plan.loopSeconds })),
  ).flat();

  const length = Math.ceil(plan.renderSeconds * sampleRate);
  const ctx = request.createContext
    ? request.createContext(2, length, sampleRate)
    : new OfflineAudioContext(2, length, sampleRate);
  const engine = new SynthEngine();
  configure(engine, sound);
  engine.attachOfflineContext(ctx);

  const motion = request.includeMotion &&
    hasPlayableMotionRoute(sound.motion.routes, Boolean(sound.cycle.slotA && sound.cycle.slotB));
  const timing = { bpm, beats: sound.motion.beats, mode: sound.motion.mode } as const;
  const run = 1;
  const scheduled = new Set<string>();
  const lookaheadFrames = Math.round(LOOP_LOOKAHEAD * sampleRate);
  const startFrames = new Map(notes.map((n) => [n.key, Math.round(n.start * sampleRate)]));
  const scheduleDue = (now: number) => {
    // The same look-ahead window as the live looper's 25 ms timer, compared in
    // whole frames: beat-aligned notes sit exactly on the window edge, and a
    // floating-point tie would schedule them a tick early in some passes only.
    const nowFrame = Math.round(now * sampleRate);
    for (const note of notes) {
      if (scheduled.has(note.key) || startFrames.get(note.key)! >= nowFrame + lookaheadFrames) continue;
      engine.scheduleNote(run, note.key, note.midi, note.start, note.end);
      scheduled.add(note.key);
    }
    engine.refreshScheduledVoices();
  };
  const motionAt = (now: number) => {
    if (motion) applyMotion(engine, sound, motionFrameAtTime(sound.motion.path, now, timing).position);
  };

  engine.beginScheduledRun(run);
  motionAt(0);
  scheduleDue(0);

  // Suspensions land on render-quantum boundaries; merge both cadences per quantum.
  // Take mode renders a tail after the single pass, and its ticks must still run
  // so released voices are retired.
  const quantum = 128;
  const lastQuantum = Math.floor((length - 1) / quantum);
  const due = new Map<number, { notes: boolean; motion: boolean }>();
  const mark = (q: number, kind: "notes" | "motion") => {
    if (q < 1 || q > lastQuantum) return;
    const entry = due.get(q) ?? { notes: false, motion: false };
    entry[kind] = true;
    due.set(q, entry);
  };
  // The note scheduler's ticks repeat identically in every pass (offsets from the
  // pass start, never accumulated), so each pass schedules on the same grid.
  // The engine rebalances voice gain when a note is scheduled, so a drifting
  // grid would make otherwise identical passes differ.
  // Offsets are rounded once, so a tick that falls on half a quantum rounds the
  // same way in every pass.
  const tickOffsets: number[] = [];
  for (let k = 0; k * LOOP_TICK_MS < plan.loopSeconds * 1000; k++) {
    tickOffsets.push(Math.round((k * LOOP_TICK_MS * sampleRate) / 1000 / quantum));
  }
  for (let pass = 0; pass * plan.loopSeconds < plan.renderSeconds; pass++) {
    const passQuantum = Math.round((pass * plan.loopSeconds * sampleRate) / quantum);
    for (const offset of tickOffsets) mark(passQuantum + offset, "notes");
  }
  if (motion) {
    for (let k = 1; k * MOTION_FRAME_SECONDS < plan.renderSeconds; k++) {
      mark(Math.round((k * sampleRate) / 30 / quantum), "motion");
    }
  }
  for (const [q, work] of [...due].sort((a, b) => a[0] - b[0])) {
    void ctx.suspend((q * quantum) / sampleRate).then(() => {
      const now = ctx.currentTime;
      if (work.motion) motionAt(now);
      if (work.notes) scheduleDue(now);
      return ctx.resume();
    });
  }

  const buffer = await ctx.startRendering();
  const from = Math.round(plan.keepFromSeconds * sampleRate);
  const frames = Math.min(buffer.length - from, Math.round(plan.keepSeconds * sampleRate));
  const channels = [0, 1].map((c) => buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)).slice(from, from + frames));
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      const v = channel[i]!;
      if (!Number.isFinite(v)) throw new Error("The render produced invalid samples.");
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
  }

  const provenance = {
    format: RENDER_FORMAT,
    version: RENDER_VERSION,
    renderedAt: new Date().toISOString(),
    sampleRate,
    channels: 2,
    mode,
    motion,
    take: { bars, bpm, beatsPerBar: 4, events: events.map((e) => ({ ...e })) },
    plan,
    peak,
    notes: "Rendered offline through Phosphor's voice and effects chain, including master volume and the output safety stage. Notes use the live looper's 100 ms look-ahead; Motion is applied at 30 Hz from the first beat.",
    sound,
  };
  return { channels, sampleRate, plan, peak, notes: once.length, motion, provenance };
}
