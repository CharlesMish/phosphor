# Slide

An intentionally synthetic one-voice instrument, built from 14 harmonic modes.
This is not a measured physical string or a bowed-string simulation. A finger
starts one excitation and retunes its continuously phased harmonics while they
decay. The engine runs in the shared AudioWorklet and in the same offline tests.

## Playing

- Ribbon horizontal range: MIDI 57–69, A3 to A4, exactly one octave.
- Touch-down sends one `pluck`; holding and moving sends `gesture` only.
- Vertical position changes the existing modal energy-loss rate, from a short
  0.18-second fundamental T60 at the bottom to 8 seconds at the top. Upper modes
  decay somewhat faster. Extending a tail cannot restore energy already lost.
- Lifting does not attack, stop, or replenish the voice. A later touch is a new
  attack with a 7 ms excitation ramp; repeated attacks have bounded amplitude.
- `Land on notes` rounds targets to semitones; DSP still smooths the transition.
- Keyboard ribbon: Space/Enter attacks once per press; left/right adjusts pitch;
  up/down changes decay. The separate Pluck button supports easy repeated notes.

## API

`new Engine(sampleRate)` exposes `command(event)` and `processSample()`.

| Command | Fields | Result |
| --- | --- | --- |
| `pluck` | `midi` 57–69, `decay` 0.18–8, `strength` 0.05–1 | Add a bounded excitation over 7 ms |
| `gesture` | optional `midi`, `decay` | Retune/damp the same ringing voice |
| `release` | none | Deliberate no-op in DSP; keep the tail |
| `stop` | none | Clear all amplitude and pending excitation |
| `reset` | none | Clear energy/phases and restore D4, 4.2 s |

Missing/non-finite values retain the previous pitch/decay or use default strength.
Pitch targets smooth over approximately 9 ms and decay over 22 ms. When idle,
a new attack begins directly at the touched pitch. No phase reset occurs for
pitch gestures or retriggers. The independent shared router fades Stop/switch.

## Evidence and limits

`node --test scripts/string-lab/slide.test.mjs` checks actual generated samples at
44.1 and 48 kHz: resting pitches, a one-attack octave glide, a continuing release
tail, irreversible damping, exact no-op release, smooth gesture event boundaries,
repeated attacks at multiple signal phases, finite/bounded output, and the demo.
The nine-second `demo` exported from `view.mjs` uses the same Engine commands.

Tests establish the signal behavior, not whether the gesture feels musically
satisfying. Real iPhone Safari/touch and listening judgments remain owner playtests.
