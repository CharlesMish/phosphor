# Phosphor — neutral contributor kit

Author a small independent bank for Charlie. This kit contains the production instrument, a neutral canonical example, a validator, and identical timed demos. It deliberately excludes the four proof sounds, their recipe, other contributors' banks and the owner reveal mapping.

Read `CAPABILITIES.md` and `CONTRACT.md` before naming sounds. Use `revision.json` to identify the exact source and engine/schema hashes. The bundled source is the reference; do not upgrade dependencies or substitute a synth implementation.

## Start and author

Use Node 22.18+ or Node 24, then:

```sh
npm ci
npm run typecheck
npm run dev -- --host 127.0.0.1
```

Open the printed `/phosphor/` address. Sounds contains one neutral example. Load it, play the keyboard, draw or select Cycle/Drive/Chorus/Space shapes, capture A/B and configure Motion. Set authored trim in **Sounds → Author tags and instructions**. **Export current sound** writes the canonical sound document through the same production capture path. **Save as new**, then **Export saved preset**, includes metadata. Uncommitted edits are only in Export current sound; Export saved preset is the selected saved record.

To start a data-only six-entry pack:

```sh
npm run presets:validate -- --template claude-r1 my-bank.pack.json
npm run presets:validate -- my-bank.pack.json --round1 --reveal my-bank-reveal.json
```

Use your assigned namespace: `claude-r1`, `grok-r1`, `gemini-r1`, or `astra-r1`. All template sounds are identical placeholders. Replace each `sound` with a canonical export and complete its metadata. Keep stable IDs when revising the same sound and increment the entry version. The library refuses an already-installed ID rather than overwriting it; remove that contributed pack's earlier entries before importing a reviewed revision. Keep its exported file as backup. Never edit engine code or a central registry to contribute a bank.

For an automated authoring recipe, produce 512 finite cycle samples in [-1,1] with the existing waveform functions; configure the other fields by modifying the canonical example. Run the real parser. For `morphLive`, compute `cycle.samples` with `cycleMorphSamples(A, B, position)` from `src/lib/synth/engine.ts`, retaining the unnormalized source endpoints. Do not normalize the blended waveform. A data-only pack is the deliverable; code recipes are optional supporting evidence.

## Render and audition

Import your pack through Sounds. Set one common tempo for a role comparison (100 BPM is the demo reference). Select the same **Demo role** for every sound in that comparison; this selects the same notes, octave, timing and leading rest. `demos.json` specifies the notes. Loading never adopts the suggested tempo; **Use suggested tempo** is a separate action. Choose a documented common transposition for an unusually high/low register outside the shipped phrase, and apply it to every candidate in that comparison.

1. **Static demo** renders with shared Motion routes disabled, retaining the saved morph position and ordinary Chorus LFO. It is not a claim that every effect is stationary.
2. **Motion demo** explicitly starts the saved routes at phrase time zero. Compare the result with the static pass.
3. **Export static WAV** / **Export Motion WAV** use the same production phrase renderer and preserve the leading beat of rest plus release/Space tail. No per-note or whole-file peak normalization occurs.
4. Free-play the keyboard. For a moving patch, press **Start Motion for keys** deliberately. A short-note sound must also be tested while holding a key: disclose that it sustains if it does.
5. Keep monitor volume fixed across a comparison. Listening trim is temporary attenuation, excluded from the saved sound and WAV. Record any listening trim alongside the audition notes. During a rendered audition, the monitor can attenuate the file; raising it above the render reference requires a new render. Authored trim is part of the sound and is applied before output safety in both live and offline graphs.

The WAV is float32 stereo at 48 kHz. Audition plays those rendered samples; ordinary keyboard/loop playback is a different performance. Motion is 30 Hz control-rate automation with smoothing and render-quantum snapping. Space is sample-rate dependent. This is **provisional offline/live correspondence**, not sample-identical live capture, seamless-loop export, or acoustic validation. Do not claim Safari/iPhone validation without running it there.

For a programmable render, serve this project with Vite and import `demoSession` from `src/lib/synth/preset-audition.ts`, then `renderPhrase` and `encodePhraseWav`. Run these in a browser: `OfflineAudioContext` is required. `demoSession(sound, role, includeMotion, bpm, monitorVolume)` creates a disposable session without touching the current take. The same methods back the shelf's buttons; do not create a Python or Node oscillator approximation.

## Round 1 brief — ready to send to each author

Please independently author **six useful Phosphor sounds**: one bass, keys, lead, pad, short-note/sequence, and wildcard. You receive the same neutral kit as the other contributors. Do not inspect their banks before the first listening round. Favor playable, distinct voicings and clear musical use over clever names. Use modest Space unless space is the point. No synthesis architecture changes.

For each sound supply a stable namespaced ID, version, contributor/provenance, roles and understandable character categories, useful register, sustained/short-note guidance, release behavior, suggested tempo if applicable, and a short gesture to try. Keep author intent, measured evidence and Charlie's listening notes separate. Mark unlistened sounds `authored-unheard` even if schema/render tests pass. Explain approximations and rejected ideas honestly. Essential unsupported fields must be rejected, not ignored.

Return one data-only `.pack.json`, its external reveal mapping, validation output and a short account of what you actually played/rendered. Render static and explicit Motion versions for moving sounds. Check representative polyphonic chords and (L+R)/2 mono fold-down if stereo effects matter; report peak, RMS and mono retention as measurements, not taste scores. Preserve the differences between candidates.

After Charlie's blind listening, round 2 is **at most two additions per contributor**, each addressing a listening-confirmed gap. Use a new `*-r2` namespace for additions and cite the gap in provenance. Do not generate that round preemptively.
