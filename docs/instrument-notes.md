# Phosphor instrument notes

Detailed behaviour, timing limits and validation caveats for the browser instrument.
The [README](../README.md) is the short introduction. These notes were carried over
from the previous README with light reorganisation; their claims are unchanged.

## Layout

The drawing area, preset/edit toolbar, and per-editor settings form one panel.
Output, envelope/filter controls, and an always-visible effects summary form the
adjacent rack. Octave and master volume live with the piano. Editor headers and
captions sit outside the canvas; compact viewports use natural scrolling.

The effects summary opens editors without toggling effects. Drive shows Identity
for the identity curve, otherwise its applied amount (including the Safe cap).
Chorus and Space show mix or Bypass at zero. Keyboard keys are native buttons:
hold Enter or Space on a focused key to play it; focus/window loss releases it.
The existing QWERTY mappings and audio engine remain in place.

Control Cabinet is the instrument's sole layout: main graph on the left, control
rack on the right, square divisions, and a full-width keyboard. The layout-study
selector, alternate layouts, and layout context have been removed. The four
Figurestead treatments remain independent visual choices. Compact screens retain
natural scrolling. The [Registration Ink caveat](#visual-treatments-and-the-registration-ink-caveat) still applies.

## Motion shapes

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

## Shared Motion destinations

Motion sends one sampled automation value to any combination of Cycle A/B,
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

## Motion continuity and timing limits

Manual morph, Motion drawing audition, and Motion playback share a persistent
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

An additional real-browser OfflineAudioContext probe is included. Start `npm run
dev`, open `/phosphor/scripts/qa/morph-render.html` on the dev server, and click
**Run audio checks**. It compares flat and tiny Motion against static references,
reproduces the old oscillator-swap behavior through the generic waveform API, and
checks cancellation. It taps the actual voice envelope before effects and plays
no audio. The original repair report records that this probe was not run in that
environment; its first recorded run is in the [development history](DEVELOPMENT_HISTORY.md#morph-probe-run).
Run it when reviewing audio changes; automated tests do not replace
an audible browser check. See the [development history](DEVELOPMENT_HISTORY.md)
for the original validation scopes and unverified observations.

## Note loop

The keyboard's **Note loop** strip records one unquantized performance from the
onscreen piano (including focused-key Enter/Space) and QWERTY keys. Choose **1, 2,
4, or 8 bars**, then Record. The meter is fixed **4/4**. Recording starts immediately,
keeps leading silence, and automatically repeats at the fixed window's end. Held
notes receive a note-off at that boundary; release tails may ring naturally. Keys
held through the boundary must be released and pressed again to play live.

The loop stores note-on/off positions in **beats**, not audio. Repeating notes use
the current synth, so CYCLE drawing, Morph, DRIVE, CHORUS, SPACE, and independent
Motion remain available. Both BPM fields edit Motion's existing tempo (40–240 BPM).
Changing BPM stops the note transport and Motion: a completed take keeps its beat
positions; an unfinished recording is discarded. Press Play to restart the take
from its beginning at the new tempo. Motion's start/phase is independent.

A dedicated 25 ms timer fills a 100 ms look-ahead queue. Oscillator starts and
attack/release envelopes are scheduled against `AudioContext.currentTime`, separate
from Motion's 30 Hz modulation controller. Run IDs and independent live/loop voice
ownership reject stale events. Stop, Clear, Escape, window blur, hiding the tab, and
component cleanup cancel future attacks and release held notes; effects can still
have natural tails. Play has a 20 ms scheduling lead. Long main-thread stalls skip
missed attacks rather than replaying them in a burst.

Record replaces the previous take. Stop during recording discards that partial
take; Stop during playback keeps it. Clear removes it, and changing bar length
clears it before the next take. There is no reload persistence, overdub, punch-in,
count-in, metronome, swing, quantization, audio recording/export, or parameter
recording (including drawing, Motion, Morph, effects, cutoff, envelope, and volume).
Scheduled envelopes use settings at scheduling time; sound/effect edits continue
through the shared engine. Polyphony retains the 12-held-voice limit.

## Saving sounds

A sound is every drawn shape and setting that defines what Phosphor plays:
the Cycle, captured A and B with the Morph position, attack/release/low-pass/
volume, Drive curve, amount and Safe, Chorus curve, period and mix, Space
contour, seed, Metal, mix and length, and the Motion path, tempo, length, mode
and destinations. Held notes, undo history, Motion's playback position, the
octave and the visual treatment are not part of a sound.

- **Autosave.** Edits are written to this browser's storage about 0.4 s after
  they stop, and when the page is hidden or closed. The last sound reopens before
  the first paint on reload. While Motion plays, autosave waits until it stops,
  then keeps the values Motion was holding.
- **Library.** The sound menu in the header saves named sounds in this browser
  (up to 48). Saving with an existing name, in any letter case, replaces that
  entry. Clearing site data removes them.
- **Files.** **Download file** writes a `.phosphor.json` file; **Open file** loads one.
  Files are versioned (`phosphor-sound`, version 1) and validated on open.
  Values outside the instrument's ranges are refused rather than clamped, so a
  reopened sound is either exact or not loaded.
- **Loading** replaces the whole sound, starts fresh undo histories and stops
  Motion. Held and looping notes keep playing and crossfade into the loaded wave
  and effects, as they do for any other edit. **New** restores a fresh visit's sound.

Storage can be unavailable (some private modes or embedded frames). The menu then
says so, and files still work.

## Visual treatments and the Registration Ink caveat

Treatments change how the instrument is drawn, never its sound or state. There are
four: Phosphor, Registration Ink, Deep Observatory and Ultraviolet Laboratory.

Registration Ink inherits its palette from Figurestead. A user-reported bug in the
upstream validation harness leaves the full Figurestead claims for this treatment
pending revalidation. Its presence here is a visual option, not a certification of
those claims. Keep this note in the developer documentation and revisit it when
corrected upstream evidence is available; the cleanup pass does not redesign the palette.

## Auditioning another branch

```bash
npm run lab -- overnight/motion-sync
npm run lab:list
```

The first command reuses that branch's worktree or creates a persistent one next to
this repository, installs its dependencies if needed, and prints its local URL.
The mental model is: **branch = version**, **worktree = local folder containing
that version**, and **`npm install` = dependencies local to that folder**.
Stop the lab server with <kbd>Ctrl</kbd>+<kbd>C</kbd>.
