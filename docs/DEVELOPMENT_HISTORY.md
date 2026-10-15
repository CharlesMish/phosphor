# Phosphor development history

The [README](../README.md) introduces the instrument. [Instrument notes](instrument-notes.md)
hold the detailed behaviour, timing limits and validation caveats. Session counts are
evidence for the revisions tested, not the current test total or a claim of
audible/visual validation.

The following links target the immutable README at `c5ff073`, before the public
orientation cleanup. They preserve the original reports, including failures to
perform browser checks and the upstream Registration Ink validation caveat.

- [Panel cleanup baseline](https://github.com/CharlesMish/phosphor/blob/c5ff073f7a7adafef64d057ba41e721650b67691/README.md#panel-cleanup-baseline)
- [Control Cabinet graduation](https://github.com/CharlesMish/phosphor/blob/c5ff073f7a7adafef64d057ba41e721650b67691/README.md#control-cabinet)
- [Shared Motion destinations](https://github.com/CharlesMish/phosphor/blob/c5ff073f7a7adafef64d057ba41e721650b67691/README.md#shared-motion-destinations)
- [Motion continuity repair and browser-probe limits](https://github.com/CharlesMish/phosphor/blob/c5ff073f7a7adafef64d057ba41e721650b67691/README.md#motion-continuity-repair)

## Morph probe run

The offline morph probe (`scripts/qa/morph-render.html`) had not been run when the
Motion continuity repair landed. On 2026-10-14 it was run against `067b8fd` in
headless Chromium (no audio device, no listening) and reported PASS: flat Motion
matched the static reference exactly (relative error 0), identical moving endpoints
stayed within 2.5e-7, tiny Motion within 6.4e-5, opposite endpoints cancelled
(RMS 0), and the reproduced legacy oscillator swap still showed a 1.31 relative
error. This confirms the rendered behaviour, not how it sounds on a device.

## String studies

The One String study and String Lab (Catch, Slide, Bow, Resonant Ends and Bowed
Slide) were string-instrument experiments, separate from the main synthesizer.
They are preserved unchanged on the
[`archive/string-studies`](https://github.com/CharlesMish/phosphor/tree/archive/string-studies)
branch (at `067b8fd`), with their code, tests and documentation
(`docs/string-lab.md`, `docs/one-string-study.md`). They are no longer on `main`
or the published site. The lasting idea from them is playing the instrument
through non-traditional phone gestures, rather than the string model itself.
