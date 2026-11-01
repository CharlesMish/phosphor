import assert from "node:assert/strict";
import { it } from "node:test";
import { createFactorySession } from "./session-apply.ts";
import { parseSessionDocument, serializeSession, type SessionDocument } from "./session-file.ts";
import {
  controlTimes,
  motionDestinationsAt,
  PHRASE_SAMPLE_RATE,
  phrasePlan,
  phraseTailSeconds,
  RENDER_QUANTUM,
  scheduledNotes,
} from "./phrase-render.ts";
import { acceptPhraseResult, beginPhraseJob, invalidatePhraseRenders } from "./phrase-export.ts";
import { generatePreset } from "./waveform.ts";
import { cycleMorphSamples } from "./engine.ts";

function session(edit: (document: SessionDocument) => void): SessionDocument {
  const document = parseSessionDocument(JSON.parse(serializeSession(createFactorySession())));
  edit(document);
  return parseSessionDocument(document);
}

it("keeps a leading rest and releases a boundary-held note at the final beat", () => {
  const document = session((value) => {
    value.motion.bpm = 120;
    value.noteLoop.bars = 1;
    value.envelope.release = 0.2;
    value.space.mix = 0;
    value.motion.routes.spaceMix = { enabled: false, from: 0, to: 0 };
    value.noteLoop.events = [
      { id: 0, type: "on", midi: 60, beat: 1 },
      { id: 0, type: "off", midi: 60, beat: 2 },
      { id: 1, type: "on", midi: 64, beat: 0 },
    ];
  });
  const notes = scheduledNotes(document);
  assert.deepEqual(notes.map((note) => [note.midi, note.start, note.end, note.boundaryHeld]), [
    [60, 0.5, 1, false],
    [64, 0, 2, true],
  ]);
  const plan = phrasePlan(document);
  assert.equal(plan.bodySeconds, 2);
  assert.equal(plan.tailSeconds, phraseTailSeconds(document));
  assert.ok(plan.tailSeconds < 0.2 + 0.03 + 0.024 + 1e-9);
  assert.equal(plan.frames, Math.ceil(plan.seconds * PHRASE_SAMPLE_RATE));
});

it("maps reversed and effects-only Motion from the start of the phrase", () => {
  const slotA = generatePreset("sine");
  const slotB = generatePreset("square");
  const document = session((value) => {
    value.cycle.slotA = null;
    value.cycle.slotB = null;
    value.cycle.morphLive = false;
    value.motion.mode = "one-shot";
    value.motion.beats = 4;
    value.motion.bpm = 120;
    value.motion.path = Array.from({ length: value.motion.path.length }, (_, index) => index / (value.motion.path.length - 1));
    value.motion.routes.cycle.enabled = true;
    value.motion.routes.driveAmount = { enabled: true, from: 0.25, to: 0 };
    value.motion.routes.chorusMix = { enabled: true, from: 0.9, to: 0.1 };
    value.motion.routes.spaceMix = { enabled: true, from: 0, to: 0.5 };
  });
  const start = motionDestinationsAt(document, 0);
  const end = motionDestinationsAt(document, 2);
  assert.equal(start.morph, null);
  assert.equal(start.driveAmount, 0.25);
  assert.equal(start.chorusMix, 0.9);
  assert.equal(end.driveAmount, 0);
  assert.ok(end.chorusMix !== null && end.chorusMix < 0.9);
  assert.equal(end.spaceMix, 0.5);

  const morphing = session((value) => {
    value.cycle.slotA = slotA;
    value.cycle.slotB = slotB;
    value.cycle.morph = 0;
    value.cycle.morphLive = true;
    value.cycle.samples = cycleMorphSamples(slotA, slotB, 0);
    value.motion.mode = "one-shot";
    value.motion.beats = 4;
    value.motion.bpm = 120;
    value.motion.path = Array.from({ length: value.motion.path.length }, (_, index) => index / (value.motion.path.length - 1));
    value.motion.routes.cycle = { enabled: true, inverted: true };
  });
  assert.equal(motionDestinationsAt(morphing, 0).morph, 1);
  assert.ok((motionDestinationsAt(morphing, 2).morph ?? 1) < 1);
});

it("places control marks on render quanta before later notes", () => {
  const duration = 2.2;
  const times = controlTimes(duration, PHRASE_SAMPLE_RATE, [0, 0.5]);
  assert.ok(times.length > 10);
  assert.deepEqual(times, controlTimes(duration, PHRASE_SAMPLE_RATE, [0, 0.5]));
  for (const time of times) {
    const frame = time * PHRASE_SAMPLE_RATE;
    assert.ok(Math.abs(frame / RENDER_QUANTUM - Math.round(frame / RENDER_QUANTUM)) < 1e-6);
    assert.ok(time > 0 && time < duration);
  }
  assert.ok(times.some((time) => time <= 0.5 && time >= 0.5 - 0.1 - RENDER_QUANTUM / PHRASE_SAMPLE_RATE));
});

it("rejects a stale phrase render when a newer job or session wins", () => {
  const job = beginPhraseJob();
  assert.equal(acceptPhraseResult(job, "a", "a"), "ok");
  invalidatePhraseRenders();
  assert.equal(acceptPhraseResult(job, "a", "a"), "stale");
  const next = beginPhraseJob();
  assert.equal(acceptPhraseResult(next, "a", "b"), "stale");
});
