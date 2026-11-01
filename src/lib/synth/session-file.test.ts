import assert from "node:assert/strict";
import { it } from "node:test";
import { cycleMorphSamples } from "./engine.ts";
import { generateMotionPreset } from "./motion.ts";
import { createFactorySession } from "./session-apply.ts";
import {
  parseSessionDocument,
  serializeSession,
  SessionFileError,
  type SessionDocument,
} from "./session-file.ts";
import { generatePreset } from "./waveform.ts";

function clone(document: SessionDocument): SessionDocument {
  return JSON.parse(serializeSession(document)) as SessionDocument;
}

function nontrivial(): SessionDocument {
  const document = clone(createFactorySession());
  const slotA = generatePreset("sine");
  const slotB = generatePreset("square");
  document.domain = "motion";
  document.cycle.slotA = slotA;
  document.cycle.slotB = slotB;
  document.cycle.morph = 0.35;
  document.cycle.morphLive = true;
  document.cycle.hasDrawn = true;
  document.cycle.preset = "custom";
  document.cycle.samples = cycleMorphSamples(slotA, slotB, 0.35);
  document.envelope.attack = 0.12;
  document.envelope.release = 0.4;
  document.filter.cutoff = 0.42;
  document.output.volume = 0.5;
  document.output.octave = -1;
  document.drive.amount = 0.2;
  document.chorus.mix = 0.15;
  document.space.mix = 0.22;
  document.space.seconds = 1.2;
  document.motion.path = generateMotionPreset("exponential");
  document.motion.mode = "loop";
  document.motion.bpm = 96;
  document.motion.beats = 2;
  document.motion.routes.cycle.enabled = true;
  document.motion.routes.driveAmount = { enabled: true, from: 0.05, to: 0.25 };
  document.motion.routes.chorusMix = { enabled: true, from: 0.8, to: 0.1 };
  document.motion.routes.spaceMix = { enabled: false, from: 0.15, to: 0.55 };
  document.noteLoop.bars = 2;
  document.noteLoop.events = [
    { id: 0, type: "on", midi: 60, beat: 1 },
    { id: 0, type: "off", midi: 60, beat: 2.25 },
    { id: 1, type: "on", midi: 64, beat: 4 },
  ];
  return parseSessionDocument(document);
}

it("round-trips a factory session and a loop with Motion", () => {
  const factory = createFactorySession();
  assert.deepEqual(parseSessionDocument(JSON.parse(serializeSession(factory))), factory);
  const session = nontrivial();
  assert.equal(session.motion.routes.chorusMix.from, 0.8);
  assert.equal(session.noteLoop.events.length, 3);
  assert.deepEqual(parseSessionDocument(JSON.parse(serializeSession(session))), session);
});

it("rejects malformed and unsupported sessions", () => {
  const base = nontrivial();
  const cases: unknown[] = [];
  cases.push(null, "nope", []);
  const extra = clone(base) as SessionDocument & { extra?: boolean };
  extra.extra = true;
  cases.push(extra);
  const version = clone(base);
  (version as { version: number }).version = 99;
  cases.push(version);
  const format = clone(base);
  (format as { format: string }).format = "other";
  cases.push(format);
  const nan = clone(base);
  nan.cycle.samples[0] = Number.NaN;
  cases.push(nan);
  const long = clone(base);
  long.envelope.attack = 2;
  cases.push(long);
  const safe = clone(base);
  safe.drive.safe = true;
  safe.drive.amount = 0.9;
  cases.push(safe);
  const beat = clone(base);
  beat.noteLoop.events[0]!.beat = 9;
  cases.push(beat);
  const orphan = clone(base);
  orphan.noteLoop.events = [{ id: 4, type: "off", midi: 60, beat: 1 }];
  cases.push(orphan);
  const morph = clone(base);
  morph.cycle.samples = generatePreset("saw");
  cases.push(morph);
  const bars = clone(base);
  (bars.noteLoop as { bars: number }).bars = 3;
  cases.push(bars);
  for (const input of cases) {
    assert.throws(() => parseSessionDocument(input), SessionFileError);
  }
});
