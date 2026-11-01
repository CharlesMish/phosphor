import { renderPhrase, type PhraseRender, type PhraseRenderOptions } from "./phrase-render";
import { captureSession } from "./session-apply";
import { serializeSession, type SessionDocument } from "./session-file";
import { useSynthStore } from "./store";
import { synth } from "./engine";
import { encodeFloatWav, type WavMetadata } from "./wav";

let activeJob = 0;

export function beginPhraseJob(): number {
  return ++activeJob;
}

export function invalidatePhraseRenders() {
  activeJob += 1;
}

/** A finished render is kept only when it is still the latest job and the session is unchanged. */
export function acceptPhraseResult(job: number, before: string, after: string): "ok" | "stale" {
  if (job !== activeJob || before !== after) return "stale";
  return "ok";
}

export async function renderCapturedPhrase(
  session: SessionDocument,
  job: number,
  options: PhraseRenderOptions = {},
): Promise<PhraseRender> {
  const before = serializeSession(session);
  const result = await renderPhrase(session, options);
  if (options.signal?.aborted || acceptPhraseResult(job, before, serializeSession(captureSession())) === "stale") {
    throw new DOMException("The render is stale.", "AbortError");
  }
  return result;
}

export const PHRASE_WAV_COMMENT =
  "Phosphor render from start. Time zero is beat 1, leading rests are kept, and there is no count-in. " +
  "Motion is sampled at 30 Hz and then smoothed by the synth; it is not sample-accurate automation. " +
  "This is one phrase plus its tail, not a recording of live playback.";

export function encodePhraseWav(session: SessionDocument, result: PhraseRender): Uint8Array {
  const metadata: WavMetadata = {
    title: "Phosphor phrase",
    software: "Phosphor",
    comment: PHRASE_WAV_COMMENT,
    json: {
      format: "phosphor-phrase",
      version: 1,
      sampleRate: result.sampleRate,
      bodySeconds: result.bodySeconds,
      tailSeconds: result.tailSeconds,
      frames: result.frames,
      bpm: session.motion.bpm,
      bars: session.noteLoop.bars,
      peak: result.peak,
      motion: "from-start",
    },
  };
  return encodeFloatWav(result.channels, result.sampleRate, metadata);
}

export function downloadPhraseWav(bytes: Uint8Array, bpm: number) {
  const blob = new Blob([Uint8Array.from(bytes)], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `phosphor-phrase-${Math.round(bpm)}bpm.wav`;
  link.click();
  URL.revokeObjectURL(url);
}

let audition: AudioBufferSourceNode | null = null;
let stopMonitor: (() => void) | null = null;
let auditionLevel: GainNode | null = null;
let listeningTrim = 0;
export function setPhraseAuditionTrim(db: number) {
  listeningTrim = Number.isFinite(db) ? Math.max(-24, Math.min(0, db)) : 0;
  updateAuditionLevel?.();
}
let updateAuditionLevel: (() => void) | null = null;

export function stopPhraseAudition() {
  const source = audition;
  const level = auditionLevel;
  audition = null; auditionLevel = null;
  stopMonitor?.(); stopMonitor = null; updateAuditionLevel = null;
  if (!source || !level) return;
  const now = source.context.currentTime;
  source.onended = () => { source.disconnect(); level.disconnect(); };
  try {
    level.gain.cancelScheduledValues(now);
    level.gain.setValueAtTime(level.gain.value, now);
    level.gain.linearRampToValueAtTime(0, now + 0.012);
    source.stop(now + 0.015);
  } catch { source.disconnect(); level.disconnect(); }
}

/** Play the rendered buffer. This is the file, not a second performance through the live looper. */
export function playPhraseRender(result: PhraseRender, monitorReference = useSynthStore.getState().volume) {
  stopPhraseAudition();
  if (!synth.unlock()) throw new Error("Audio is unavailable.");
  const ctx = synth.getContext();
  if (!ctx) throw new Error("Audio is unavailable.");
  const buffer = ctx.createBuffer(2, result.channels[0].length, result.sampleRate);
  buffer.copyToChannel(new Float32Array(result.channels[0]), 0);
  buffer.copyToChannel(new Float32Array(result.channels[1]), 1);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const level = ctx.createGain();
  auditionLevel = level;
  const update = () => {
    const volume = useSynthStore.getState().volume;
    // Reference render contains monitor gain. Zero-volume renders stay silent.
    const gain = monitorReference > 0 ? Math.min(1, (volume / monitorReference) ** 2) : 0;
    level.gain.setTargetAtTime(gain * 10 ** (listeningTrim / 20), ctx.currentTime, 0.02);
  };
  updateAuditionLevel = update;
  level.gain.value = 10 ** (listeningTrim / 20);
  update(); stopMonitor = useSynthStore.subscribe(update);
  source.connect(level).connect(ctx.destination);
  audition = source;
  source.onended = () => {
    if (audition === source) {
      audition = null; auditionLevel = null;
      stopMonitor?.(); stopMonitor = null; updateAuditionLevel = null;
      source.disconnect(); level.disconnect();
    }
  };
  source.start();
}
