import { beatDurationSeconds } from "./motion";
import { hasPlayableMotionRoute } from "./motion-routing";
import {
  PHRASE_SAMPLE_RATE,
  PhraseRenderError,
  phraseTailSeconds,
  renderNotes,
  type PhraseRender,
  type PhraseRenderOptions,
  type ScheduledNote,
} from "./phrase-render";
import { parseSessionDocument, type SessionDocument } from "./session-file";
import { encodeFloatWav, type WavMetadata } from "./wav";
import {
  chordName,
  loopNotes,
  planChordExport,
  type ExportEnding,
  type ExportPlan,
  type LoopChord,
} from "./chord-loop";

export type ChordLoopRequest = {
  chords: readonly LoopChord[];
  transpose: number;
  times: number;
  ending: ExportEnding;
};

export type ChordLoopRender = PhraseRender & {
  plan: ExportPlan;
  ending: ExportEnding;
  /** Seconds rendered before the file starts, so a looped file opens with the previous pass's tail. */
  leadSeconds: number;
};

/** Length of the fade at the top of a loop file from the end's continuation into the lead-in render. */
export const LOOP_SEAM_FADE_SECONDS = 0.04;

/**
 * Seconds of lead-in for a seamless loop. It covers the longest tail and a
 * full attack, and reaches back to the start of every earlier note that is
 * still audible at the top of the file, so none of them is started late (a
 * late start would put it out of phase with the same note at the file's end).
 */
export function loopLeadSeconds(session: SessionDocument, chords: readonly LoopChord[] = []): number {
  const tail = phraseTailSeconds(session);
  let lead = Math.max(tail, session.envelope.attack) + 0.1;
  const beat = beatDurationSeconds(session.motion.bpm);
  const total = chords.reduce((sum, c) => sum + c.beats, 0) * beat;
  if (total <= 0) return lead;
  for (let pass = -1; pass >= -1000; pass--) {
    let audible = false;
    let at = pass * total;
    for (const chord of chords) {
      const end = at + chord.beats * beat;
      if (end + tail > 0) { audible = true; lead = Math.max(lead, -at + 0.05); }
      at = end;
    }
    if (!audible) break;
  }
  return lead;
}

export function motionTimingOf(session: SessionDocument) {
  const cycleAvailable = Boolean(session.cycle.slotA && session.cycle.slotB);
  return {
    mode: session.motion.mode,
    beats: session.motion.beats,
    active: hasPlayableMotionRoute(session.motion.routes, cycleAvailable),
  };
}

export function chordLoopPlan(session: SessionDocument, request: ChordLoopRequest): ExportPlan {
  return planChordExport(request.chords, session.motion.bpm, request.times, request.ending,
    motionTimingOf(session), phraseTailSeconds(session));
}

/**
 * Notes for the render, in render seconds.
 * - loop: the file is `times` passes long. Rendering starts `lead` seconds
 *   early inside the previous pass, so the file opens with that pass's tails
 *   and ends where it begins. Motion's beat 1 is the file's first sample.
 * - take: `times` passes from silence, plus the release and Space tail.
 */
export function chordLoopNotes(session: SessionDocument, request: ChordLoopRequest, times: number, lead: number): ScheduledNote[] {
  const beat = beatDurationSeconds(session.motion.bpm);
  const total = request.chords.reduce((sum, c) => sum + c.beats, 0) * beat;
  const firstPass = lead > 0 && total > 0 ? -Math.ceil(lead / total) : 0;
  // A loop also queues the pass after the file, so the file's last moments
  // see the next downbeat coming exactly as the lead-in saw its own.
  const lastPass = lead > 0 ? times : times - 1;
  return loopNotes(request.chords, request.transpose, firstPass, lastPass)
    .map((n) => ({ midi: n.midi, start: lead + n.startBeat * beat, end: lead + n.endBeat * beat, boundaryHeld: false }))
    .filter((n) => n.end > 0)
    .map((n) => ({ ...n, start: Math.max(0, n.start) }))
    .filter((n) => n.end > n.start);
}

export async function renderChordLoop(
  input: SessionDocument,
  request: ChordLoopRequest,
  options: PhraseRenderOptions = {},
): Promise<ChordLoopRender> {
  const session = parseSessionDocument(input);
  if (!request.chords.length) throw new PhraseRenderError("Add a chord to the loop first.");
  const plan = chordLoopPlan(session, request);
  if (!plan.ok) throw new PhraseRenderError(plan.note);
  const sampleRate = options.sampleRate ?? PHRASE_SAMPLE_RATE;
  const bodyFrames = Math.round(plan.bodySeconds * sampleRate);

  if (request.ending === "take") {
    const tail = phraseTailSeconds(session);
    const frames = Math.ceil((plan.bodySeconds + tail) * sampleRate);
    const notes = chordLoopNotes(session, request, plan.times, 0);
    const result = await renderNotes(session, notes,
      { bodySeconds: plan.bodySeconds, tailSeconds: tail, seconds: frames / sampleRate, frames, sampleRate }, options, 0);
    return { ...result, plan, ending: "take", leadSeconds: 0 };
  }

  const lead = loopLeadSeconds(session, request.chords);
  const leadFrames = Math.round(lead * sampleRate);
  const leadExact = leadFrames / sampleRate;
  // Render a little past the end too: that is the true continuation of the
  // file's last sample. The file's first frames fade from it into the lead-in
  // render, so the join is continuous even where something runs on its own
  // clock (the chorus LFO, Motion's 30 Hz sampling).
  const fade = Math.min(Math.round(LOOP_SEAM_FADE_SECONDS * sampleRate), Math.floor(bodyFrames / 2));
  const frames = leadFrames + bodyFrames + fade;
  const notes = chordLoopNotes(session, request, plan.times, leadExact);
  const full = await renderNotes(session, notes,
    { bodySeconds: frames / sampleRate, tailSeconds: 0, seconds: frames / sampleRate, frames, sampleRate }, options, leadExact);
  const channels: [Float32Array, Float32Array] = [
    full.channels[0].slice(leadFrames, leadFrames + bodyFrames),
    full.channels[1].slice(leadFrames, leadFrames + bodyFrames),
  ];
  for (let ch = 0; ch < 2; ch++) {
    const source = full.channels[ch as 0 | 1];
    const target = channels[ch as 0 | 1];
    for (let i = 0; i < fade; i++) {
      const w = 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / fade);
      target[i] = source[leadFrames + bodyFrames + i]! * (1 - w) + target[i]! * w;
    }
  }
  let peak = 0;
  for (const channel of channels) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  return {
    bodySeconds: bodyFrames / sampleRate,
    tailSeconds: 0,
    seconds: bodyFrames / sampleRate,
    frames: bodyFrames,
    sampleRate,
    channels,
    peak,
    plan,
    ending: "loop",
    leadSeconds: leadExact,
  };
}

export const CHORD_LOOP_WAV_COMMENT =
  "Phosphor chord loop render. Loop files hold whole passes and open with the previous pass's tail, so they repeat seamlessly; " +
  "take files start from silence and keep the final tail. Motion starts at the top of the file and is sampled at 30 Hz.";

export function encodeChordLoopWav(session: SessionDocument, request: ChordLoopRequest, result: ChordLoopRender): Uint8Array {
  const metadata: WavMetadata = {
    title: "Phosphor chord loop",
    software: "Phosphor",
    comment: CHORD_LOOP_WAV_COMMENT,
    json: {
      format: "phosphor-chord-loop-render",
      version: 1,
      ending: result.ending,
      times: result.plan.times,
      bpm: session.motion.bpm,
      loopSeconds: result.plan.loopSeconds,
      sampleRate: result.sampleRate,
      frames: result.frames,
      transpose: request.transpose,
      chords: request.chords.map((c) => ({ name: chordName(c.notes, request.transpose), notes: c.notes.map((n) => n + request.transpose), beats: c.beats })),
      peak: result.peak,
    },
  };
  return encodeFloatWav(result.channels, result.sampleRate, metadata);
}
