# One-string study

Live study: https://charlesmish.github.io/phosphor/one-string/

The standalone browser experiment supplied in `one-string-study.zip` is hosted under `public/one-string/`. Vite copies these static files into the existing Pages build. Its only hosting changes are relative HTML asset URLs and resolving the worklet URL relative to `main.js`.

Open the HTTPS page, click **Enable audio**, then drag the string and release, or use **Repeat pluck**. No local installation is required.

This is the original playtest baseline, separate from Phosphor's main synth and the native Apple study. The reviewed baseline's retrigger discontinuity and audio-startup retry limitation remain follow-up work. Reload the page if enabling audio fails. The musical engine is unchanged.

The source package's 41 DSP checks were independently rerun successfully before hosting. Desktop/browser and device listening remain distinct from those offline checks.
