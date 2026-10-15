# Phosphor

**Draw the cycle. Draw the space. Play the result.**

**[Play Phosphor in your browser →](https://charlesmish.github.io/phosphor/)**

Phosphor is a small synthesizer where every part of the sound is something you draw.
Instead of turning knobs on a hidden engine, you sketch the structures the audio is
made from, then play them from the keyboard.

## What you draw

| Panel | What your drawing becomes |
| --- | --- |
| **Cycle** | One period of the oscillator. The curve becomes a Web Audio `PeriodicWave`. |
| **Morph** | Capture two cycles as A and B, then blend between them while notes are held. |
| **Motion** | A tempo-synced path that moves the A/B blend and, optionally, Drive, Chorus and Space. |
| **Drive** | The distortion transfer curve, applied after the low-pass filter. |
| **Chorus** | The stereo delay-time cycle between Drive and Space. |
| **Space** | The overall shape of a 1–3 second reverb. Deterministic detail underneath becomes the impulse response. |

Four visual **treatments** (Phosphor, Registration Ink, Deep Observatory, Ultraviolet
Laboratory) change how the instrument looks, never how it sounds.

## First minute

1. Open the instrument and press a key: the onscreen piano, or `A W S E D F T G Y H U J K O L P ; '` on a keyboard.
2. Drag across the **Cycle** graph to redraw the wave while a note rings. Start from Sine, Tri, Saw, Sqr or Wild if you like.
3. Press **Set A**, draw something different, press **Set B**, then move the **Morph** slider.
4. Open **Motion**, choose a shape such as **3:3:2**, hold a note and press **Play**.
5. Try a **Drive** curve, then add **Chorus** and **Space**.
6. Use **Note loop** to record 1–8 bars and keep reshaping the sound while it repeats.

`Esc` stops all sound. `Ctrl/⌘ + Z` undoes the last edit. Up to 12 notes can sound at once.

## Current limits

- **Nothing is saved yet.** Shapes, captured A/B cycles and note-loop takes are lost when the page reloads.
- **No audio export.** The note loop stores note timings, not sound, so there is no way yet to render a take to a file.
- **Phones get a stacked layout.** The website works on a phone, but the keyboard sits below the drawing, so you scroll between them. A native study (below) explores a phone-first layout.
- **Motion is not sample-accurate.** It is updated from a 30 Hz timer with smoothed ramps. Note-loop timing uses separate look-ahead scheduling.

[Instrument notes](docs/instrument-notes.md) cover these limits and the exact behaviour of each panel.

## Where it's heading

- Save and reopen drawn shapes and A/B captures.
- Render a note-loop take to a WAV file, so a sound made here can be taken into other tools.
- Play the instrument through phone gestures rather than a piano keyboard.

A native iOS and macOS **Cycle Study** is in progress as a draft in
[pull request #9](https://github.com/CharlesMish/phosphor/pull/9). Earlier
string-instrument experiments (One String and String Lab) are preserved on the
[`archive/string-studies`](https://github.com/CharlesMish/phosphor/tree/archive/string-studies)
branch.

## Run it locally

You need Node.js 22.12 or newer (CI uses Node.js 22).

```bash
npm ci
npm run dev
```

Then open <http://localhost:8080/phosphor/>.

To try another branch side by side, run `npm run lab -- <branch>`. See
[auditioning another branch](docs/instrument-notes.md#auditioning-another-branch).

### Checks

```bash
npm run test:synth
npm run typecheck
npm run build
```

For changes to audio behaviour, also run the offline morph probe: with `npm run dev`
running, open `/phosphor/scripts/qa/morph-render.html` and click **Run audio checks**.
Automated checks do not replace listening in a real browser.

### Standalone export

```bash
npm run build
node scripts/export-standalone.mjs
```

This writes `dist/phosphor.html`, a single file with code, styles, fonts and favicon
embedded. It needs no network once built. The export step fetches the Google Fonts
files once.

### Deployment

`main` deploys to GitHub Pages through `.github/workflows/pages.yml`. The Vite base
path is `/phosphor/`, matching the Pages URL.

## Contributing

`main` is the playable baseline. Make each musical or visual change on its own branch
from `main`, run the checks, and open a pull request. Describe what changed in the
sound or the look, and report listening and browser observations separately from
automated results, including what was not tested.

`src/lib/synth/` owns sound and state; `src/components/synth/` owns the interface.
Keep the Registration Ink caveat and the timing limits in
[instrument notes](docs/instrument-notes.md) accurate. The
[development history](docs/DEVELOPMENT_HISTORY.md) indexes earlier session reports.

## License

CharlesMish's original contributions to Phosphor are available under the
[MIT License](LICENSE). Dependencies and externally supplied assets retain
their own licenses and copyright notices.

The interface loads IBM Plex Mono and Space Grotesk from Google Fonts. Those
fonts are licensed under the SIL Open Font License 1.1, not this project's MIT
grant: [IBM Plex Mono license](https://github.com/google/fonts/blob/main/ofl/ibmplexmono/OFL.txt)
and [Space Grotesk license](https://github.com/google/fonts/blob/main/ofl/spacegrotesk/OFL.txt).
If you redistribute a standalone export with embedded fonts or dependencies,
include their applicable licenses and notices.
