# Bowed Slide

This study combines Slide's pitch gesture with Bow's continuing excitation.

- Horizontal position sets pitch across A3–A4 (MIDI 57–69).
- Vertical **movement speed** supplies bow energy. Vertical position itself has no timbre or decay mapping.
- Touching silently establishes contact. Up/down strokes feed the sound; diagonal strokes change pitch at the same time. Lateral rocking adds vibrato while bowing.
- Lifting or holding still stops new excitation and leaves the resonator's tail.
- `Land on notes` defaults on. It uses continuous attraction, `m − 0.85 sin(2πm)/(2π)`, rather than rounding: note centers are easier to hold, but bends remain. Turn it off for a uniform pitch ribbon.
- Focus the surface and hold Up/Down for a steady bow. Hold Left/Right to glide. The first keyboard event releases pointer ownership; touching again clears held keyboard state.

The view sends `{type:'bow', active, speed, midi}`. Pointer excitation depends only on vertical velocity, decays within 130 ms of the last movement, and is refreshed while held. The engine also needs its independent stale-control watchdog. Cancel, blur, pointer cancellation and lost capture release input state. No device pressure, sensors or second controller are required.

`Show me` uses the same engine commands: bow a fixed D4, glide to G4, add vibrato, hold still, then release. Its 40 ms control intervals stay within the DSP watchdog while active; the final 2.2 seconds allow the remaining tone to fade. Demo visuals are separate from the user's control state and clear on interruption.

This is an expressive synthetic bowed-string study, not a physical bow simulation. Absolute height is deliberately unassigned so a later controller can explore timbre independently of the main hand's pitch.
