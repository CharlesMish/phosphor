# Phosphor

**Draw the cycle. Draw the space. Play the result.**

Phosphor is a browser instrument built around directly manipulating DSP structures:

- **CYCLE** — draw one oscillator period; the drawing becomes a Web Audio `PeriodicWave`.
- **A/B Morph** — capture two cycles and continuously interpolate between them while notes are held.
- **SPACE** — draw the macro energy contour of a finite impulse response; deterministic microstructure underneath it becomes the actual convolution IR.
- **Figurestead treatments** — change the rendering of the instrument without changing its sound or state.

## Run locally

```bash
npm install
npm run dev
```

Then open <http://localhost:8080>.

### Audition another branch

```bash
npm run lab -- overnight/motion-sync
npm run lab:list
```

The first command reuses that branch's worktree or creates a persistent one next to
this repository, installs its dependencies if needed, and prints its local URL.
The mental model is: **branch = version**, **worktree = local folder containing
that version**, and **`npm install` = dependencies local to that folder**.
Stop the lab server with <kbd>Ctrl</kbd>+<kbd>C</kbd>.

## Checks

```bash
npm run test:synth
npm run typecheck
npm run build
```

## Deployment

`main` deploys automatically to GitHub Pages through `.github/workflows/pages.yml`.

The Vite base path is `/phosphor/`, matching the repository Pages URL.

## Development rule

Treat `main` as the playable baseline. New musical or rendering experiments should happen on branches and merge back only after review.
