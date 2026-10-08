# Mac handoff: Phosphor Cycle Study

Continue this existing SwiftUI / AVAudioEngine / C project. Charlie wants to try
the native drawn-waveform instrument. The browser String Lab, bowed-string
experiments, motion control, and second-controller ideas are separate work.

## First run

1. Read `README.md` and `CHECKS.md`. Work in this extracted folder; preserve the
   supplied source before making any local repair.
2. Confirm this is a Mac and `xcodebuild -version` works. If only Command Line
   Tools are selected, explain how to choose full Xcode under Xcode's Settings →
   Locations. Do not install tools, change signing accounts, or use `sudo` silently.
3. Run `bash scripts/check-mac.sh`. It runs the C audio checks, builds the Mac
   app, and runs isolated instrument-state tests. It needs no npm or packages.
4. Launch with `open build/macOS/Build/Products/Debug/PhosphorStudy.app`.
   Alternatively open `PhosphorStudy.xcodeproj`, choose **PhosphorStudy → My Mac**,
   and run. **CycleModelChecks** is the test scheme, not the playing app.
5. If a real build or launch blocker appears, make the smallest repair in this
   project, rerun the affected check, and report what changed. Preserve the C
   audio core and the native app architecture.

The command-line build is unsigned for local development. Xcode may ask Charlie
to choose his development team for device signing. Do not publish, notarize,
merge PR #9, or submit an app release as part of this handoff.

## Let Charlie play

Start at a modest system volume. Use the built-in speaker or wired headphones
for the first latency check. Let Charlie judge the sound; test results do not
establish that the instrument feels musical.

- Hold a piano key, release it, and use Stop. Try another note immediately.
- Draw an uneven curve, release the stroke, use Smooth, then Undo.
- Choose Clear: silence is expected. Choose Sine to get a tone back.
- Hold a note while changing its curve if the input device allows it.
- Switch away and return; change the audio output once. A new deliberate press
  should recover playback, without a stuck note or unexpected automatic restart.
- Quit and reopen; confirm the last committed curve is retained.

The instrument is monophonic. The newest held note takes over; releasing it returns
to an older key only if that key is still held. Stop clears held-note playback;
release and press again to start fresh. Mouse playing means pressing the on-screen keys;
computer-keyboard performance mapping is not part of this build.

For iPhone later, use the **PhosphorStudy** scheme with an iPhone simulator or
connected device. Device signing and actual audio-route/phone-interruption feel
are local checks, separate from the automated simulator result.

## Report back

Return the Mac/Xcode versions, commands and results, whether the app launched,
any repairs, and Charlie's listening observations separately. Keep the next
iteration tied to a concrete blocker or playing friction he identifies.
