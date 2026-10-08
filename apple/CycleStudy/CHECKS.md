# Cycle Study verification

This hardening pass starts from native draft PR #9 at
`0b310b11ebcb20f90e9e2550e95178bde9f93238` in `CharlesMish/phosphor`.

## Checks included

- Six portable C test groups cover pitch/envelopes, bounded output, DC removal,
  waveform crossfades, harmonic filtering, invalid input, queue saturation,
  concurrent rendering, and rapid note changes at 8–192 kHz.
- Thirteen isolated model tests cover press ownership, held-note fallback,
  Stop/late releases, failed-start recovery, accessibility timers, drawing
  preview/commit/cancellation, Undo, stored-wave validation and flat-curve status.
- The Apple Cycle Study workflow builds macOS, runs model tests on macOS,
  builds iOS, and runs the iPhone simulator draw/play/release/Stop UI check.

The local Linux C run passes with AddressSanitizer and UBSan. Only leak detection
is disabled here (`ASAN_OPTIONS=detect_leaks=0`) because this environment cannot
inspect `/proc`. The macOS workflow uses the default sanitizer settings.

The authoritative native result is the **Apple Cycle Study** workflow for the
exact source revision. See the verification record bundled with the downloaded
handoff package for its checked commit and completed run.

## What automation does not establish

The UI test exercises controls and visible state; it does not listen to the
speaker or measure device latency. No physical-device listening verdict is
claimed. Charlie's Mac/iPhone output, headphones, route changes, phone
interruptions, two-finger playing, and perceived responsiveness still need the
short local session in `CODEX_HANDOFF.md`.

The instrument is a conservative Fourier/wavetable synth, not an exact port of
browser Phosphor. Pitch changes have a fixed 5 ms blend; edits have a 25 ms
crossfade. The tiny captured pitch tail cannot respond to new controls until it
finishes. Device loudness still depends on system volume.
