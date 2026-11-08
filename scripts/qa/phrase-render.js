import { cycleMorphSamples } from "../../src/lib/synth/engine.ts";
import { generateDrivePreset } from "../../src/lib/synth/drive.ts";
import { generateMotionPreset } from "../../src/lib/synth/motion.ts";
import { renderPhrase } from "../../src/lib/synth/phrase-render.ts";
import { decodeFloatWav } from "../../src/lib/synth/wav.ts";
import { encodePhraseWav } from "../../src/lib/synth/phrase-export.ts";
import {
  applySession,
  captureSession,
  createFactorySession,
  restoreLocalSession,
} from "../../src/lib/synth/session-apply.ts";
import { SESSION_STORAGE_KEY, parseSessionDocument, serializeSession } from "../../src/lib/synth/session-file.ts";
import { noteLooper } from "../../src/lib/synth/looper-runtime.ts";
import { useSynthStore } from "../../src/lib/synth/store.ts";
import { generatePreset } from "../../src/lib/synth/waveform.ts";
import { generateSpaceContour } from "../../src/lib/synth/space.ts";

const result = document.querySelector("#result");
const checks = [];

function check(name, ok, detail) {
  checks.push({ name, ok, detail });
}

function clone(document) {
  return parseSessionDocument(JSON.parse(serializeSession(document)));
}

function base(edit) {
  const document = clone(createFactorySession());
  document.motion.bpm = 120;
  document.noteLoop.bars = 1;
  document.envelope.attack = 0.01;
  document.envelope.release = 0.2;
  document.output.volume = 0.8;
  document.filter.cutoff = 1;
  document.space.mix = 0;
  document.space.seconds = 1;
  document.chorus.mix = 0;
  document.drive.amount = 0;
  document.drive.safe = true;
  document.motion.mode = "one-shot";
  document.motion.beats = 4;
  document.motion.routes.spaceMix = { enabled: false, from: 0, to: 0 };
  document.motion.routes.chorusMix = { enabled: false, from: 0, to: 0 };
  document.motion.routes.driveAmount = { enabled: false, from: 0, to: 0 };
  document.motion.routes.cycle.enabled = false;
  edit(document);
  return parseSessionDocument(document);
}

function ramp(document) {
  const n = document.motion.path.length;
  document.motion.path = Array.from({ length: n }, (_, index) => index / (n - 1));
}

function peakOf(channel, start = 0, end = channel.length) {
  let peak = 0;
  for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(channel[i]));
  return peak;
}

function rms(channel, start, end) {
  let sum = 0;
  const count = Math.max(1, end - start);
  for (let i = start; i < end; i++) sum += channel[i] * channel[i];
  return Math.sqrt(sum / count);
}

function firstLoud(channel, threshold = 1e-4) {
  for (let i = 0; i < channel.length; i++) if (Math.abs(channel[i]) > threshold) return i;
  return -1;
}

function maxDiff(a, b) {
  const count = Math.min(a.length, b.length);
  let diff = 0;
  for (let i = 0; i < count; i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
  return diff;
}

function sameSamples(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function finite(channels) {
  return channels.every((channel) => channel.every((sample) => Number.isFinite(sample)));
}

async function renderPair(document) {
  const audition = await renderPhrase(document);
  const decoded = decodeFloatWav(encodePhraseWav(document, audition));
  return { audition, decoded };
}

function assertRender(name, document, audition, decoded) {
  const left = audition.channels[0];
  const right = audition.channels[1];
  const durationOk = left.length === audition.frames
    && Math.abs(left.length / audition.sampleRate - (audition.bodySeconds + audition.tailSeconds)) < 1 / audition.sampleRate + 1e-9;
  const wavOk = decoded.sampleRate === audition.sampleRate
    && sameSamples(decoded.channels[0], left)
    && sameSamples(decoded.channels[1], right);
  const peak = Math.max(peakOf(left), peakOf(right));
  check(`${name} duration`, durationOk, { frames: left.length, body: audition.bodySeconds, tail: audition.tailSeconds });
  check(`${name} wav matches audition`, wavOk, { decoded: decoded.channels[0]?.length ?? 0 });
  check(`${name} finite`, finite(audition.channels), {});
  check(`${name} peak`, peak > 1e-4 && peak <= 0.9801, { peak });
  return { left, right, peak };
}

try {
  const slotA = generatePreset("sine");
  const slotB = generatePreset("square");
  const saved = base((document) => {
    document.domain = "motion";
    document.cycle.slotA = slotA;
    document.cycle.slotB = slotB;
    document.cycle.morph = 0.25;
    document.cycle.morphLive = true;
    document.cycle.preset = "custom";
    document.cycle.hasDrawn = true;
    document.cycle.samples = cycleMorphSamples(slotA, slotB, 0.25);
    document.motion.path = generateMotionPreset("exponential");
    document.motion.mode = "loop";
    document.motion.bpm = 100;
    document.motion.beats = 2;
    document.motion.routes.cycle.enabled = true;
    document.motion.routes.chorusMix = { enabled: true, from: 0.75, to: 0.05 };
    document.noteLoop.bars = 2;
    document.noteLoop.events = [
      { id: 0, type: "on", midi: 60, beat: 1 },
      { id: 0, type: "off", midi: 60, beat: 2 },
      { id: 1, type: "on", midi: 67, beat: 4 },
    ];
  });
  useSynthStore.getState().applyPreset("saw");
  applySession(JSON.parse(serializeSession(saved)));
  const reloaded = captureSession();
  check("loop with Motion reloads", JSON.stringify(reloaded) === JSON.stringify(saved), {
    state: noteLooper.getSnapshot().state,
    playing: useSynthStore.getState().motionPlaying,
  });
  check("reload is stopped", noteLooper.getSnapshot().state === "stopped" && !useSynthStore.getState().motionPlaying, {});
  localStorage.setItem(SESSION_STORAGE_KEY, serializeSession(saved));
  applySession(createFactorySession());
  const report = restoreLocalSession(localStorage);
  check("clean session restores the loop", report === "restored" && JSON.stringify(captureSession()) === JSON.stringify(saved), { report });
  const intact = serializeSession(captureSession());
  let rejected = false;
  try {
    applySession({ ...saved, version: 99 });
  } catch {
    rejected = true;
  }
  check("rejected file leaves the session", rejected && serializeSession(captureSession()) === intact, {});

  const notes = [
    { id: 0, type: "on", midi: 60, beat: 0 },
    { id: 0, type: "off", midi: 60, beat: 2 },
  ];
  const staticSession = base((document) => {
    document.cycle.samples = generatePreset("sine");
    document.noteLoop.events = notes;
  });
  const first = await renderPair(staticSession);
  const second = await renderPhrase(staticSession);
  const staticInfo = assertRender("static", staticSession, first.audition, first.decoded);
  check("static repeat matches", sameSamples(first.audition.channels[0], second.channels[0]) && sameSamples(first.audition.channels[1], second.channels[1]), {});
  const stereoGap = peakOf(staticInfo.left.map((sample, index) => sample - staticInfo.right[index]));
  check("static channels match in phase", stereoGap < 1e-6, { stereoGap });
  const onset = firstLoud(staticInfo.left);
  check("static onset is at the first beat", onset >= 0 && onset < 0.02 * first.audition.sampleRate, { onset });
  const releaseStart = Math.floor(1 * first.audition.sampleRate);
  const releaseRms = rms(staticInfo.left, releaseStart, releaseStart + Math.floor(0.08 * first.audition.sampleRate));
  const endRms = rms(staticInfo.left, staticInfo.left.length - Math.floor(0.04 * first.audition.sampleRate), staticInfo.left.length);
  check("static tail decays", releaseRms > endRms * 4 && endRms < 1e-4, { releaseRms, endRms });

  const moving = base((document) => {
    document.cycle.slotA = slotA;
    document.cycle.slotB = slotB;
    document.cycle.morph = 0;
    document.cycle.morphLive = true;
    document.cycle.samples = cycleMorphSamples(slotA, slotB, 0);
    document.cycle.preset = "custom";
    ramp(document);
    document.motion.routes.cycle.enabled = true;
    document.noteLoop.events = notes;
  });
  const frozen = clone(moving);
  frozen.motion.routes.cycle.enabled = false;
  const movingRender = await renderPair(moving);
  const frozenRender = await renderPhrase(parseSessionDocument(frozen));
  assertRender("morph", moving, movingRender.audition, movingRender.decoded);
  const morphDiff = maxDiff(movingRender.audition.channels[0], frozenRender.channels[0]);
  check("changing morph differs from the held cycle", morphDiff > 1e-3, { morphDiff });

  const forward = base((document) => {
    document.cycle.samples = generatePreset("saw");
    ramp(document);
    document.motion.routes.chorusMix = { enabled: true, from: 0, to: 0.9 };
    document.noteLoop.events = notes;
  });
  const reversed = clone(forward);
  reversed.motion.routes.chorusMix = { enabled: true, from: 0.9, to: 0 };
  const forwardRender = await renderPair(forward);
  const reversedRender = await renderPair(parseSessionDocument(reversed));
  assertRender("reversed chorus", reversed, reversedRender.audition, reversedRender.decoded);
  const reverseDiff = maxDiff(forwardRender.audition.channels[0], reversedRender.audition.channels[0]);
  const reverseStereo = maxDiff(reversedRender.audition.channels[0], reversedRender.audition.channels[1]);
  check("reversed chorus Motion differs from forward", reverseDiff > 1e-3, { reverseDiff });
  check("chorus Motion is stereo", reverseStereo > 1e-4, { reverseStereo });

  const effects = base((document) => {
    document.cycle.slotA = null;
    document.cycle.slotB = null;
    document.cycle.morphLive = false;
    document.cycle.samples = generatePreset("saw");
    document.drive.curve = generateDrivePreset("soft");
    document.drive.preset = "soft";
    document.space.contour = generateSpaceContour("room");
    ramp(document);
    document.motion.routes.cycle.enabled = true;
    document.motion.routes.driveAmount = { enabled: true, from: 0, to: 0.25 };
    document.motion.routes.chorusMix = { enabled: true, from: 0, to: 0.85 };
    document.motion.routes.spaceMix = { enabled: true, from: 0, to: 0.45 };
    document.noteLoop.events = notes;
  });
  const dry = clone(effects);
  dry.motion.routes.driveAmount.enabled = false;
  dry.motion.routes.chorusMix.enabled = false;
  dry.motion.routes.spaceMix.enabled = false;
  const effectsRender = await renderPair(effects);
  const dryRender = await renderPhrase(parseSessionDocument(dry));
  assertRender("effects-only", effects, effectsRender.audition, effectsRender.decoded);
  const effectsDiff = maxDiff(effectsRender.audition.channels[0], dryRender.channels[0]);
  check("effects-only Motion differs from the saved amounts", effectsDiff > 1e-3, { effectsDiff });

  const rest = base((document) => {
    document.cycle.samples = generatePreset("sine");
    document.noteLoop.events = [
      { id: 4, type: "on", midi: 72, beat: 1 },
      { id: 4, type: "off", midi: 72, beat: 2 },
    ];
  });
  const restRender = await renderPair(rest);
  const restInfo = assertRender("leading rest", rest, restRender.audition, restRender.decoded);
  const rate = restRender.audition.sampleRate;
  const earlyPeak = peakOf(restInfo.left, 0, Math.floor(0.45 * rate));
  const restOnset = firstLoud(restInfo.left);
  check("leading rest stays silent", earlyPeak < 1e-5, { earlyPeak });
  check("leading rest onset is on beat 2", Math.abs(restOnset / rate - 0.5) < 0.02, { onset: restOnset / rate });

  const boundary = base((document) => {
    document.cycle.samples = generatePreset("triangle");
    document.noteLoop.events = [{ id: 0, type: "on", midi: 60, beat: 0 }];
  });
  const boundaryRender = await renderPhrase(boundary);
  const boundaryLeft = boundaryRender.channels[0];
  const after = Math.floor(boundaryRender.bodySeconds * boundaryRender.sampleRate);
  const ring = rms(boundaryLeft, after, after + Math.floor(0.06 * boundaryRender.sampleRate));
  const tailEnd = rms(boundaryLeft, boundaryLeft.length - Math.floor(0.03 * boundaryRender.sampleRate), boundaryLeft.length);
  check("boundary-held note rings into the tail and then decays", ring > tailEnd * 4 && tailEnd < 1e-3, { ring, tailEnd });
} catch (error) {
  check("runner", false, { message: error instanceof Error ? error.stack ?? error.message : String(error) });
}

const ok = checks.every((item) => item.ok);
result.textContent = JSON.stringify({ ok, checks }, null, 2);
document.title = ok ? "PHRASE_OK" : "PHRASE_FAIL";
