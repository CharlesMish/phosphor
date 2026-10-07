# Phosphor · Cycle Study

A tiny native instrument for iPhone, iPad, and Mac. Draw one repeating waveform,
then hold a piano key to hear it. This is an experiment in whether drawing and
playing feels good as an Apple app, before exploring motion or physical controls.

## Open and play

1. On your Mac, open **PhosphorStudy.xcodeproj** in Xcode 16 or newer.
2. Select the **PhosphorStudy** scheme and **My Mac**, or an iPhone simulator.
3. Press **⌘R**. Pick Sine, Triangle, Saw, or Square, then hold a key.
4. Draw across the panel. The new sound applies when you lift your finger/mouse.

For a real iPhone, connect it to your Mac, choose it as the run destination, and
select your Apple development team under the app target's **Signing & Capabilities**.
If Xcode reports that the bundle identifier is unavailable, change it to a unique
identifier of your own. Enable Developer Mode on the phone if Xcode asks.
No microphone, camera, motion permission, server, account, or package install is needed.

## What is here

- One 256-point drawn cycle, with interpolated strokes and a zero line.
- Sine, triangle, saw, square, clear, smooth, and one-step undo.
- One voice across C4–C5, touch/mouse hold to play, volume, and Stop.
- Last curve saved on this device; edits apply on release.
- Native SwiftUI interface and AVAudioEngine output shared across both platforms.
- VoiceOver labels and short notes via accessibility activation.

This is a separate study inspired by [browser Phosphor](https://charlesmish.github.io/phosphor/).
It does not import its presets or recreate its effects, A/B morphing, automation,
looper, or exact timbre. System fonts only; no bundled third-party assets.

## First listening session

Start at low volume on the built-in speaker or wired headphones. Bluetooth output
can add latency. Try Sine → draw an uneven curve → Smooth → Undo. Is drawing a
sound satisfying? Can you reliably hold and release a note? Is the display big
enough on your phone? These observations should decide the next experiment.

Also check two-finger use (hold a note while drawing), background/foreground,
headphone connection changes, and phone interruptions. Sound intentionally stops
when the app becomes inactive. It does not keep playing in the background.
The voice is monophonic: the newest pressed note wins, and releasing it does not
resume an older held key. There is no computer-keyboard performance mapping yet.

## Build and verification

The deployment floors are iOS 16 and macOS 13. The project has no dependencies.

```sh
# Portable DSP checks, including address/undefined-behavior sanitizers:
sh scripts/test-dsp.sh

# Native builds on a Mac (no signing required for these checks):
xcodebuild -project PhosphorStudy.xcodeproj -scheme PhosphorStudy \
  -destination 'generic/platform=macOS' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project PhosphorStudy.xcodeproj -scheme PhosphorStudy \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

The repository's **Apple Cycle Study** workflow builds both platforms and runs an
iPhone simulator interaction test, saving logs, an Xcode result bundle, and a
screenshot. Passing those checks does not verify real-device latency or musical
feel. Check the workflow result for the exact revision you are trying.

The C tests cover frequency, DC removal, bounded finite output, note release,
waveform transitions, harmonic filtering, queue overflow, invalid inputs, and
concurrent control/render activity. In restricted Linux environments where leak
sanitizer cannot inspect processes, use `ASAN_OPTIONS=detect_leaks=0`; this leaves
address and undefined-behavior checks enabled.

## Small architecture

`InstrumentView` edits the curve and reports gestures to `InstrumentModel`.
`AudioController` owns AVAudioEngine and a stable C synth handle. The render
callback calls `pc_render`; it does not allocate, acquire locks, or call SwiftUI.
The control thread builds a Fourier bank and publishes it through a bounded
single-producer/single-consumer queue. The audio thread consumes the newest edit.

The drawing is resynthesized with up to 64 harmonics, omitting DC. Seven tables
with different harmonic limits keep the selected harmonics below 45% of the
48 kHz source rate. This is conservative filtering, not an exact Web Audio
PeriodicWave port or a claim of perfect alias-free synthesis. Edits crossfade over
25 ms; notes have a 12 ms attack and 60 ms release; volume is smoothed. Peak output
is capped at 0.2 in the synth (device loudness still depends on system volume).
Hard pitch changes can change the selected harmonic table; this study has no
portamento. AVAudioEngine handles conversion to the output device's format.

Keep future experiments small: first improve playing feel, then try one motion
mapping. A second controller, string resonator, looper, or product packaging can
be evaluated separately after that.

MIT licensed under the repository's root LICENSE.
