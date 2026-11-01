import { LOOP_LOOKAHEAD, loopDurationSeconds } from "./note-looper";
import { SynthEngine } from "./engine";
import { motionFrameAtTime } from "./motion";
import { mapMotionRoute } from "./motion-routing";
import { parseSessionDocument, type SessionDocument } from "./session-file";

/** File sample rate. Space's impulse is built at this rate, so the file does not follow the device rate. */
export const PHRASE_SAMPLE_RATE = 48000;
/** Same control rate as live Motion. This is not sample-accurate automation. */
export const MOTION_CONTROL_HZ = 30;
/** OfflineAudioContext renders in blocks of this many frames. Control marks snap to them. */
export const RENDER_QUANTUM = 128;
/**
 * After the release ramp the voice source stays connected for 30 ms, and the
 * chorus delay can hold up to 24 ms of the signal.
 */
export const PHRASE_TAIL_PAD_SECONDS = 0.03 + 0.024;

export class PhraseRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhraseRenderError";
  }
}

export type ScheduledNote = {
  midi: number;
  start: number;
  end: number;
  /** No note-off was stored, so the note is released on the final beat of the phrase. */
  boundaryHeld: boolean;
};

export type PhrasePlan = {
  bodySeconds: number;
  tailSeconds: number;
  seconds: number;
  frames: number;
  sampleRate: number;
};

export type MotionDestinations = {
  /** Path position at this elapsed time, before route mapping. */
  position: number;
  morph: number | null;
  driveAmount: number | null;
  chorusMix: number | null;
  spaceMix: number | null;
};

type AppliedDestinations = {
  morph: number | null;
  driveAmount: number | null;
  chorusMix: number | null;
  spaceMix: number | null;
};

export type PhraseRenderOptions = {
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
  sampleRate?: number;
};

export type PhraseRender = PhrasePlan & {
  channels: [Float32Array, Float32Array];
  peak: number;
};

function timingOf(session: SessionDocument) {
  return {
    bpm: session.motion.bpm,
    beats: session.motion.beats,
    mode: session.motion.mode,
  } as const;
}

/** Space contributes its full length when the phrase can send audio into it. */
export function spaceTailSeconds(session: SessionDocument): number {
  const route = session.motion.routes.spaceMix;
  const audible = session.space.mix > 0 || (route.enabled && (route.from > 0 || route.to > 0));
  return audible ? session.space.seconds : 0;
}

export function phraseTailSeconds(session: SessionDocument): number {
  return session.envelope.release + spaceTailSeconds(session) + PHRASE_TAIL_PAD_SECONDS;
}

export function phrasePlan(session: SessionDocument, sampleRate = PHRASE_SAMPLE_RATE): PhrasePlan {
  const bodySeconds = loopDurationSeconds(session.motion.bpm, session.noteLoop.bars);
  const tailSeconds = phraseTailSeconds(session);
  const seconds = bodySeconds + tailSeconds;
  const frames = Math.ceil(seconds * sampleRate);
  return { bodySeconds, tailSeconds, seconds, frames, sampleRate };
}

/**
 * Notes in phrase time. Time zero is the first beat. Missing note-offs are
 * released at the end of the bar window. A note that ends at or before it
 * starts is omitted.
 */
export function scheduledNotes(session: SessionDocument): ScheduledNote[] {
  const beat = loopDurationSeconds(session.motion.bpm, session.noteLoop.bars) / (session.noteLoop.bars * 4);
  const boundary = session.noteLoop.bars * 4;
  const offs = new Map<number, number>();
  for (const event of session.noteLoop.events) {
    if (event.type === "off") offs.set(event.id, event.beat);
  }
  const notes: ScheduledNote[] = [];
  for (const event of session.noteLoop.events) {
    if (event.type !== "on") continue;
    const off = offs.get(event.id);
    const endBeat = off ?? boundary;
    const start = event.beat * beat;
    const end = endBeat * beat;
    if (end <= start) continue;
    notes.push({ midi: event.midi, start, end, boundaryHeld: off === undefined });
  }
  return notes;
}

/** Motion destinations at an elapsed render time. Disabled routes stay null. */
export function motionDestinationsAt(session: SessionDocument, elapsed: number): MotionDestinations {
  const position = motionFrameAtTime(session.motion.path, elapsed, timingOf(session)).position;
  const routes = session.motion.routes;
  const cycle = routes.cycle.enabled && session.cycle.slotA && session.cycle.slotB
    ? (routes.cycle.inverted ? 1 - position : position)
    : null;
  return {
    position,
    morph: cycle,
    driveAmount: routes.driveAmount.enabled ? mapMotionRoute("driveAmount", routes.driveAmount, position) : null,
    chorusMix: routes.chorusMix.enabled ? mapMotionRoute("chorusMix", routes.chorusMix, position) : null,
    spaceMix: routes.spaceMix.enabled ? mapMotionRoute("spaceMix", routes.spaceMix, position) : null,
  };
}

/**
 * Deterministic control marks inside the render: 30 Hz motion frames, plus a
 * mark at or before each later note so the note is queued inside the live
 * lookahead while its onset time is still in the future. Marks lie on render
 * quanta. Applying the value at the quantum's audio time is control-rate
 * sampling, not sample-accurate automation.
 */
export function controlTimes(duration: number, sampleRate: number, noteStarts: number[]): number[] {
  const marks = new Set<number>();
  const addRounded = (seconds: number) => {
    if (!(seconds > 0) || seconds >= duration) return;
    const q = Math.round((seconds * sampleRate) / RENDER_QUANTUM);
    const when = (q * RENDER_QUANTUM) / sampleRate;
    if (when > 0 && when < duration) marks.add(when);
  };
  for (let k = 1; k / MOTION_CONTROL_HZ < duration; k++) addRounded(k / MOTION_CONTROL_HZ);
  for (const start of noteStarts) {
    if (start <= 0) continue;
    const early = Math.max(0, start - LOOP_LOOKAHEAD);
    const q = Math.floor((early * sampleRate) / RENDER_QUANTUM);
    const when = (q * RENDER_QUANTUM) / sampleRate;
    if (when > 0 && when < duration && when <= start) marks.add(when);
  }
  return [...marks].sort((a, b) => a - b);
}

/** Install saved amounts before the graph exists so render frame 0 does not slew from class defaults. */
function prime(engine: SynthEngine, session: SessionDocument): AppliedDestinations {
  const start = motionDestinationsAt(session, 0);
  engine.setParams({
    attack: session.envelope.attack,
    release: session.envelope.release,
    volume: session.output.volume,
    trimDb: session.output.trimDb,
    cutoff: session.filter.cutoff,
  });
  engine.setDriveState(
    session.drive.curve,
    start.driveAmount ?? session.drive.amount,
    session.drive.safe,
  );
  engine.setChorusCurve(session.chorus.curve);
  engine.setChorusPeriod(session.chorus.period);
  engine.setChorusMix(start.chorusMix ?? session.chorus.mix);
  engine.setSpace(session.space.contour, session.space.seed, session.space.metal, session.space.seconds);
  engine.setSpaceMix(start.spaceMix ?? session.space.mix);
  return {
    morph: start.morph,
    driveAmount: start.driveAmount,
    chorusMix: start.chorusMix,
    spaceMix: start.spaceMix,
  };
}

function finishGraph(engine: SynthEngine, session: SessionDocument, applied: AppliedDestinations) {
  engine.setChorusCurve(session.chorus.curve);
  engine.setSpace(session.space.contour, session.space.seed, session.space.metal, session.space.seconds);
  const { slotA, slotB, morphLive, morph, samples } = session.cycle;
  if (applied.morph !== null && slotA && slotB) engine.setCycleMorph(slotA, slotB, applied.morph);
  else if (morphLive && slotA && slotB) engine.setCycleMorph(slotA, slotB, morph);
  else engine.setWaveform(samples, true);
}

function applyDestinations(
  engine: SynthEngine,
  session: SessionDocument,
  elapsed: number,
  applied: AppliedDestinations,
) {
  const next = motionDestinationsAt(session, elapsed);
  const { slotA, slotB } = session.cycle;
  if (next.morph !== null && next.morph !== applied.morph && slotA && slotB) {
    engine.setCycleMorph(slotA, slotB, next.morph);
    applied.morph = next.morph;
  }
  if (next.driveAmount !== null && next.driveAmount !== applied.driveAmount) {
    engine.setDriveState(session.drive.curve, next.driveAmount, session.drive.safe);
    applied.driveAmount = next.driveAmount;
  }
  if (next.chorusMix !== null && next.chorusMix !== applied.chorusMix) {
    engine.setChorusMix(next.chorusMix);
    applied.chorusMix = next.chorusMix;
  }
  if (next.spaceMix !== null && next.spaceMix !== applied.spaceMix) {
    engine.setSpaceMix(next.spaceMix);
    applied.spaceMix = next.spaceMix;
  }
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Render one phrase plus its tail through a fresh production engine.
 * Audition and WAV export both use this buffer. Ordinary live playback is
 * not involved and is not resynchronized.
 */
export async function renderPhrase(
  session: SessionDocument,
  options: PhraseRenderOptions = {},
): Promise<PhraseRender> {
  session = parseSessionDocument(session);
  const sampleRate = options.sampleRate ?? PHRASE_SAMPLE_RATE;
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
    throw new PhraseRenderError("Unsupported sample rate.");
  }
  const notes = scheduledNotes(session);
  if (notes.length === 0) throw new PhraseRenderError("A completed note loop is required.");
  if (typeof OfflineAudioContext === "undefined") {
    throw new PhraseRenderError("Offline audio is unavailable.");
  }
  const plan = phrasePlan(session, sampleRate);
  const renderSeconds = plan.frames / sampleRate;
  const ctx = new OfflineAudioContext(2, plan.frames, sampleRate);
  const engine = new SynthEngine();
  const queued = new Set<string>();
  const scheduleDue = (now: number) => {
    notes.forEach((note, index) => {
      const key = String(index);
      if (queued.has(key) || note.start > now + LOOP_LOOKAHEAD || note.end <= now) return;
      engine.scheduleNote(1, key, note.midi, note.start, note.end);
      queued.add(key);
    });
  };

  try {
    if (options.signal?.aborted) throw new DOMException("The render was cancelled.", "AbortError");
    const applied = prime(engine, session);
    engine.attachOfflineContext(ctx);
    finishGraph(engine, session, applied);
    engine.beginScheduledRun(1);
    scheduleDue(0);
    engine.refreshScheduledVoices();
    options.onProgress?.(0);

    const marks = controlTimes(renderSeconds, sampleRate, notes.map((note) => note.start));
    for (const when of marks) {
      void ctx.suspend(when).then(async () => {
        if (options.signal?.aborted) {
          await ctx.resume();
          return;
        }
        const now = ctx.currentTime;
        applyDestinations(engine, session, now, applied);
        scheduleDue(now);
        engine.refreshScheduledVoices();
        options.onProgress?.(Math.min(1, now / renderSeconds));
        await yieldToUi();
        if (options.signal?.aborted) {
          await ctx.resume();
          return;
        }
        await ctx.resume();
      });
    }

    const buffer = await ctx.startRendering();
    if (options.signal?.aborted) throw new DOMException("The render was cancelled.", "AbortError");
    const channels: [Float32Array, Float32Array] = [
      buffer.getChannelData(0).slice(),
      buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1)).slice(),
    ];
    let peak = 0;
    for (const channel of channels) {
      if (channel.length !== plan.frames) throw new PhraseRenderError("The render length changed.");
      for (let i = 0; i < channel.length; i++) {
        const sample = channel[i]!;
        if (!Number.isFinite(sample)) throw new PhraseRenderError("The render produced a non-finite sample.");
        const abs = Math.abs(sample);
        if (abs > peak) peak = abs;
      }
    }
    options.onProgress?.(1);
    return { ...plan, channels, peak };
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException("The render was cancelled.", "AbortError");
    throw error;
  } finally {
    engine.dispose();
  }
}
