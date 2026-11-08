# Engine capabilities at the pinned revision

| Area | Supported behavior | Limit / honest wording |
|---|---|---|
| Source | 512-point drawn periodic cycle; Fourier bins 0–255; pitched Web Audio PeriodicWave | No sample playback, FM, noise source, physical tine/string/piano model or velocity layers |
| Conditioning | Remove DC, peak-scale individual cycle or A/B endpoint to 0.9; silent input stays silent; Web Audio normalization disabled | Blended A/B output is not re-normalized. Opposite endpoints can cancel; this is meaningful |
| A/B | Two phase-coherent source waves per voice, linear morph gains with ~32 ms ramps | Shared morph value; no independent per-voice envelopes or modulation |
| Envelope | Attack 4–800 ms, release 30–2200 ms; sustained held level | No decay/sustain controls. Short release changes the lifted key, not a held key. Short-note plucks require short note gates |
| Filter | Shared low-pass; normalized 0–1 maps logarithmically from 180 Hz to 18 kHz | No filter envelope/resonance control in this contract |
| Drive | 257-point transfer shape, amount, Safe; 10 Hz DC block and deterministic attenuation guard | Not an oscillator architecture. Safe amount max 0.25; unsafed max 1. Shape changes alter spectrum and loudness |
| Chorus | Drawn 256-point delay LFO, 0.25–4 s period, mix; stereo delay excursion 8–24 ms | Global effect, no unison/per-voice detune. Mono fold-down may change color |
| Space | 512-point energy contour, seed, Metal flag, 1–3 s length and mix | Seed is required. IR synthesis depends on device sample rate. Render tests use 48 kHz |
| Motion | Shared 512-point path; one-shot, loop or ping-pong; 1/2/4/8-beat length; 40–240 BPM | Routes only to A/B morph, Drive amount, Chorus mix, Space mix. No pitch, cutoff, amplitude-envelope or independent note routing |
| Polyphony | Up to 12 held voices; releasing tails and voice gain rebalance; final safety stage | Chord level is not the sum of fixed single-note levels. Measure chords; do not normalize every note |
| Levels | Monitor gain is squared 0–1; authored trim -48–0 dB after effects/before safety; listening trim -24–0 dB after safety | Monitor and listening trim are not sound metadata or DSP voicing. Listening trim is session-only and not in exports |

Useful targets: rounded bass, bright sustained synth keys, organ/reed-like lines, soft pads, gated sequences, morphing textures. Acoustic piano, bowed-string articulation, per-key pluck decay, velocity response, FM bells and independent per-note LFOs are outside this engine. A synthetic keyboard voicing can be useful on its own terms.

Character labels are coarse author judgments. Brightness and body/warmth are independent axes; a sound can be bright and full. Attack labels describe the onset, not the harmonic envelope of a held note. Motion labels refer to audible change, not merely an enabled checkbox. Width is separate from spatial depth.

Vocabulary inspiration: [Audio Commons, The Timbre of Sound (2018)](https://audiocommons.github.io/2018/09/05/timbre-sound.html). This project uses local author tags; it does not run the Audio Commons models or claim calibrated perceptual scores.
