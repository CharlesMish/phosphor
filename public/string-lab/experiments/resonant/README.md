# Resonant Ends

Question: is conspicuous, repeatable sound placement more enjoyable than the
original ideal-string position contrast?

- Pull/release the main surface: horizontal location chooses the body character;
  pull distance sets strength. A tap gives a moderate attack.
- Buttons provide the same three anchor plucks. Focused surface: arrows choose
  position, Space/Enter plucks. These are alternatives, not required controls.
- Body slider: morph the existing sound without plucking. Wood is short and
  rounded, center has a relatively plain string response, metal rings longer
  with inharmonic body modes. Silence remains silent when the body moves.
- Cancelled gestures do not pluck. Stop clears all energy. Normal mouse and
  unpressurized touch are sufficient.

## Implementation and limits

The shared fixed-pitch string is joined by seven damped synthetic body modes.
Location continuously interpolates low-pass cutoff, string/body mixture, modal
weights and decay. These are designed wood/open/metal impressions, not a physical
claim about the opposite ends of a real string. The body modes are not separately
playable notes. There is no convolution, reverb, chord generator or sample bank.

The body target smooths over roughly 25 ms. Changing body affects current energy
and timbre; it cannot reconstruct a note that has already died. All modal states
are bounded and are excited by velocity additions rather than displacement jumps.
The shared string has its own 8 ms retrigger crossfade. Source output is bounded
by a soft limiter at +/-0.68. This is a perceptual prototype, not a material or
acoustic simulation. The resting string animation follows output level and is
illustrative, not a visualization of the seven oscillator states.

## Commands

- `{type:'pluck', position:0..1, strength:0..1, frequency?:80..880}`
- `{type:'body', value:0..1}`
- `{type:'stop'}` clears excitation/energy.
- `{type:'reset'}` also restores the middle body and 220 Hz.

Default pitch is 220 Hz. Frequency is not exposed as a setup control. The 10.6 s
Show me timeline compares equal-strength left/center/right plucks, then morphs
one continuing middle note toward metal and back toward wood.

## Checks performed

`node --test scripts/string-lab/resonant.test.mjs`: seven tests pass. Actual output
at both 44.1 and 48 kHz establishes finite bounded samples, conspicuous short/long
decay differences, spectral contrast after gain normalization, and body changes
on an existing note. Early .03–.23 s RMS across the anchors is within 3.9 dB;
metal's first-difference brightness is more than twice wood's at equal gain.
Rapid repeated plucks, nonfinite inputs, Stop and Reset were covered.

Browser integration and real-device feel are reviewed by the parent agent/user.
The measurements do not establish whether Charlie finds this enjoyable.
