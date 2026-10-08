# String Lab

A small browser playground for four ways of shaping a single sound. Published at
`/phosphor/string-lab/`. The original `/phosphor/one-string/` remains a comparison.

| Experiment | Playing gesture | Question |
| --- | --- | --- |
| Catch | Pull/release to pluck; a graded damper consumes the ringing energy. Hold damper supports mouse-only muted attacks. | Can controlling the ending create a satisfying rhythm? |
| Slide | Touch once to excite; move across A3–A4 with continuous phase; move vertically for decay. | Can the player aim, glide, and return to a pitch? |
| Bow | Rub to supply energy; vertical position changes silk/grain. Stillness ends excitation. | Is sustained shaping rewarding? |
| Resonant Ends | Pluck through wood/open/metal responses; reshape the current tail with the body strip. | Does location make a clear and repeatable sonic choice? |

Enable audio starts the worklet from a real user gesture. Show me plays a short
interruptible event timeline through the same engine as hand playing. Stop and
Escape clear input and fade audio; Reset restores the current experiment.
Ordinary mouse and touch work without pressure or device-motion permissions.

## Implementation

Static ES modules under `public/string-lab/` are copied by the existing Vite
build. Paths are relative so worklet imports remain valid under the Pages prefix.
There are no new package dependencies, external assets, service calls, microphone
requests, or accounts. The existing native app work is not part of this change.

One `AudioHost`, context, and worklet node serve all four engines. Control epochs
discard stale events after Stop or a mode change. Startup can recover from a
failed module load. Pausing also clears held gestures and demonstration playback.

The experiment contract is deliberately small:

- `experiments/<id>/engine.mjs`: `Engine(sampleRate)`, `command(event)`,
  `processSample()`; engines run in both Node tests and the real worklet.
- `experiments/<id>/view.mjs`: `mount(container, api)`, with reset/cancel/dispose
  and demo-frame methods, plus a bounded demo timeline.
- `shared/string-voice.mjs`: loss-smoothed plucked waveguide used by Catch and
  Resonant Ends. Retriggers blend a bounded 8 ms old tail into the new excitation.
- `worklet.mjs`: routing, output metering, stale-control rejection, and 10 ms
  Stop/switch fades. Each fade uses a fixed-size tail, not accumulated voices.

Slide uses harmonic modes with continuous phases rather than resetting the
baseline delay each time the pitch changes. Bow is a synthetic harmonic resonator
driven by motion, not a validated violin friction simulation. Resonant Ends mixes
the string with designed inharmonic body modes; its three regions are intentional
sound designs, not a claim about opposite ends of an ideal physical string.

## Validation

Run `npm run test:string-lab` after the repository's normal `npm ci`, or use
`node --test scripts/string-lab/*.test.mjs` directly; these new tests use Node
built-ins. The Pages workflow runs them alongside the existing synth tests,
typecheck, and production build.

Rendered-output tests cover 44.1/48 kHz: graded damping and no energy revival;
continuous pitch and no attack on release; bow speed/texture and stationary/stale
input decay; resonant differences beyond gain; finite bounded output; varied-phase
retriggers; Stop/switch continuity and stale-epoch rejection. Independent tests
exercise all four engines. Host tests reproduce failed startup and lifecycle races.

Headphones may reveal extra detail, but the first playtest should use the player's
usual speakers. Automated output checks establish behavior, not musical appeal.
Actual iPhone Safari feel and perceived latency require a physical-device playtest.
The short 8–10 ms fade tails do not respond to changes made after they are captured.

## Next iteration

Ask: Was the change obvious? Could I get it again? Did I want to keep playing?
Pick one experiment and one reported friction for the next bounded implementation.
A builder handoff should identify the exact commit, permitted files, desired
behavior, repeatable gesture, and targeted acceptance checks. Review one candidate
and one focused repair before seeking another player verdict. The reserved drawn
excitation and phrase-loop ideas are intentionally outside this first build.
