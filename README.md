# Phosphor

**Draw the cycle. Draw the space. Play the result.**

Phosphor is a browser instrument built around directly manipulating DSP structures:

- **CYCLE** — draw one oscillator period; the drawing becomes a Web Audio `PeriodicWave`.
- **A/B Morph** — capture two cycles and continuously interpolate between them while notes are held.
- **MOTION** — draw a BPM-synchronized A/B morph trajectory and audition it live.
- **DRIVE** — draw the transfer function applied after the low-pass filter.
- **CHORUS** — draw the stereo delay-time cycle between DRIVE and SPACE.
- **SPACE** — draw the normalized macro contour of a 1–3 second impulse response; deterministic microstructure underneath it becomes the actual convolution IR.
- **Figurestead treatments** — change the rendering of the instrument without changing its sound or state.

## Run locally

```bash
npm ci
npm run dev
```

Then open <http://localhost:8080>.

### Audition another branch

```bash
npm run lab -- overnight/motion-sync
npm run lab:list
```

The first command reuses that branch's worktree or creates a persistent one next to
this repository, installs its dependencies if needed, and prints its local URL.
The mental model is: **branch = version**, **worktree = local folder containing
that version**, and **`npm install` = dependencies local to that folder**.
Stop the lab server with <kbd>Ctrl</kbd>+<kbd>C</kbd>.

## Checks

```bash
npm run test:synth
npm run typecheck
npm run build
```

## Deployment

`main` deploys automatically to GitHub Pages through `.github/workflows/pages.yml`.

The Vite base path is `/phosphor/`, matching the repository Pages URL.

## Development rule

Treat `main` as the playable baseline. New musical or rendering experiments should happen on branches and merge back only after review.

### Treatment validation note

Registration Ink inherits its palette from Figurestead. A user-reported bug in the upstream validation harness leaves the full Figurestead claims for this treatment pending revalidation. Its presence here is a visual option, not a certification of those claims. Keep this note in the developer documentation and revisit it when corrected upstream evidence is available; the cleanup pass does not redesign the palette.

### Panel cleanup baseline

The drawing area, preset/edit toolbar, and per-editor settings form one panel.
Output, envelope/filter controls, and an always-visible effects summary form the
adjacent rack. Octave and master volume live with the piano. Editor headers and
captions sit outside the canvas; compact viewports use natural scrolling.

The effects summary opens editors without toggling effects. Drive shows Identity
for the identity curve, otherwise its applied amount (including the Safe cap).
Chorus and Space show mix or Bypass at zero. Keyboard keys are native buttons:
hold Enter or Space on a focused key to play it; focus/window loss releases it.
The existing QWERTY mappings and audio engine remain in place.

Cleanup validation: the 75 existing tests, typecheck, and production build pass.
A separate DOM regression probe exercised focused piano key press/release, key
repeat, focus/window loss, and effect summaries/navigation. This is not a claim
of browser visual validation; compact/tablet rendering, 200% zoom, and treatment
switching still need a browser review before merging this baseline.

## Control Cabinet

Control Cabinet is the instrument's sole layout: main graph on the left, control
rack on the right, square divisions, and a full-width keyboard. The layout-study
selector, alternate layouts, and layout context have been removed. The four
Figurestead treatments remain independent visual choices. Compact screens retain
natural scrolling. The Registration Ink validation caveat above still applies.

Motion includes four editable starting shapes: Sweep, Log, Exponential, and
3:3:2. Log rises quickly and eases toward 100%; Exponential starts gently and
accelerates toward 100%. Both are smooth, normalized curves spanning 0–100%.
Like Sweep, they reset from 100% to 0% in Loop mode; choose Ping-pong to travel
back along the curve instead. 3:3:2 makes three rounded pulses occupying 3/8,
3/8, and 2/8 of the selected duration, with smooth joins and matching loop
endpoints. At 8 beats that is 3 + 3 + 2 beats; at 4 beats, 1.5 + 1.5 + 1 beat.
Choose a shape, hold a note, and press Play. Choosing a shape stops playback and
creates one undoable Motion edit; it does not change captured waves, timing,
other histories, or the current sound. The audio engine is unchanged.

Cabinet graduation validation: all 94 tests, typecheck, and production build pass,
including shape bounds, loop endpoints, undo/redo, stale playback rejection, and
sound preservation. Browser visual validation was not performed in this pass.

Build a single downloadable instrument with embedded code, styles, fonts, and
favicon:

```bash
npm run build
node scripts/export-standalone.mjs
```

Open `dist/phosphor.html` directly in a browser. The export command fetches the
existing Google Fonts assets once; the exported instrument needs no network.

## Shared Motion destinations

Motion now sends one sampled automation value to any combination of Cycle A/B,
Drive Amount, Chorus wet mix, and Space wet mix. Each effect has a From/To range;
reverse the endpoints for opposing movement. Cycle remains the only destination
on by default. Effects-only Motion works without captured A/B waves.

Try 3:3:2 + Loop with Chorus 0–35% and Space 15–55%, hold a note, and press Play.
Use destination From/To endpoints to narrow the movement. Drive automation is
always bounded to 0–25%, even when Safe is off; it controls the existing transfer
Amount, not a new wet/dry path. Choose a non-Identity Drive curve to hear it.

Destination/range edits stop playback without immediately changing sound. Stop
holds the last values. Moving a manually controlled amount/mix stops Motion only
if that destination is enabled. Disabled destinations retain their current values.
The direct A/B slider remains Cycle-only. A/B Swap reverses Cycle's route direction
while preserving the shared path and its histories, so effects do not invert too.

All destinations share the existing 30 Hz audio-clock-based playback controller.
Chorus and Space use their existing smoothed gain controls; Drive updates its
bounded transfer table. Flat effect frames skip redundant writes. Motion does not
rebuild Space impulse responses, Chorus LFO tables, or held-note oscillators to
animate effects. Full effect-shape interpolation and look-ahead transport remain
outside this addition.

Validation: 104 tests, typecheck, and production build pass. Coverage includes
synchronized dispatch with/without A/B, reversed ranges and Drive caps, manual
control priority, stop/late-tick rejection, history isolation, A/B Swap equivalence,
and engine graph stability through repeated effect updates. No new browser audio
or visual verification was performed in this pass.

## Motion continuity repair

`fix/phase-continuous-motion` carries the selected Control Cabinet layout and
ports the audio-only repair from the earlier, unmerged `1c7c4bd` quality study.
Manual morph, Motion drawing audition, and Motion playback now share a persistent
pair of oscillators per note. A and B start at the same audio timestamp; later
morph frames ramp complementary gains over 32 ms instead of replacing oscillators
and rebuilding wave tables. Repeated flat frames leave the existing ramp alone.
Interrupted ramps resume from the calculated current blend, including loop wraps.

Endpoints are conditioned once per endpoint change. Intermediate blends are no
longer normalized to full height: opposite endpoints can become quiet or cancel,
and the displayed Cycle samples represent that same linear blend. This deliberately
changes the loudness of some existing A/B transitions. Direct Cycle drawing keeps
its existing single-wave crossfade. Entering morph on a held note or replacing a
captured endpoint still makes one structural crossfade and can have a brief phase
interaction; it does not recur on every Motion frame.

The repair also cancels queued direct-wave updates when morph takes over or a
finished drawing supplies an immediate update. Polyphony, release, voice stealing,
effects, treatments, and the one-shot default remain intact. Motion still reads the
audio clock from a 30 Hz main-thread timer: gain ramps remove hard control steps,
but this is not sample-accurate look-ahead transport scheduling. An intentionally
looped ramp still returns toward A at the seam, now through the gain ramp; use
ping-pong for an outward-and-return trajectory.

Validation: 91 tests pass, including engine-node lifecycle, gain-ramp interruption,
queued-update cancellation, store dispatch, identical/near-identical endpoints,
linear cancellation, and the existing history/effect tests. Typecheck and the
production build pass. These tests do not substitute for an audible browser check.

An additional real-browser OfflineAudioContext probe is included. Start `npm run
dev`, open `/phosphor/scripts/qa/morph-render.html` on the dev server, and click
**Run audio checks**. It compares flat and tiny Motion against static references,
reproduces the old oscillator-swap behavior through the generic waveform API, and
checks cancellation. It taps the actual voice envelope before effects and plays
no audio. This browser probe was not executed in the repair environment because
the local browser connection was unavailable and direct file navigation was blocked.
