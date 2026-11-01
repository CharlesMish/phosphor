# Preset foundation — review record, 1 November 2026

Review branch: `review/phosphor-preset-foundation-2026-11-01`. No production merge or deployment.

## Foundation decision

The workspace had no Phosphor checkout or local changes. A fresh isolated clone was created. Remote main and all four requested PR heads were inspected; their observed heads were unchanged on the recheck before delivery.

| Work | Inspected revision | Decision |
|---|---|---|
| main | `067b8fd6a39a55d8db6ed85ec5c9088f3519028b` | Preserved; including the existing string studies |
| #14 README/archive | `966244ce438402e991b22f5dcbc06f803e958795` | Not applied: moving/removing string studies is unrelated to preset foundation |
| #15 save sounds | `a16b1458c8249bb3bdc76ee570bec27105cc622d` | Reused sound family, legacy validator and single shelf location; replaced name-based overwrite and independent sound autosave with protected copies and shared session persistence |
| #16 loop WAV | `14a73311e61179e6f71a724ed32e01c2727bb7fd` | Inspected engine changes, note pairing, render plan and Motion rules. Kept separate: seamless-loop priming and device-rate export serve a different task than preserved-rest role audition |
| #17 sessions/render | `495b2473645a85985cf9b717deca83168a6d1705` | Branch foundation: completed-take persistence, strict unknown-field checks, canonical morph consistency and production phrase rendering. Its offline retirement fix overlaps #16; no duplicate rendering engine was added |

No existing PR was retargeted, closed or merged; no existing branch was edited. The review PR can be considered as a reconciliation based on #17, not instructions to merge all overlapping work.

`phosphor-sound` v2 is a versioned evolution of #15, not an unrelated serializer. Its validator reuses #17's strict DSP validation. Session v2 adds authored trim; session v1 migrates with trim zero. Both old storage families remain read-only migration inputs. See the [contract](../../contributor-kit/CONTRACT.md) for exact old/new behavior and engine normalization.

## Result

One compact Sounds shelf provides role filters, all-word character search, favorites, protected originals, Save as new, rename copy, duplicate, JSON import/export and per-role demo audition/export. Author tags and instructions remain editable outside DSP. Stable namespaced IDs survive renames; copied sounds receive new UUID IDs. Blind mode hides names/contributors; an external mapping permits reveal. Metadata-only edits cannot change oscillator interpretation.

Four authored-unheard proof sounds: bass, chordal synthetic keys, a lead and an evolving pad. They use the existing Cycle/A-B, attack/release, low-pass and effects; no new synthesis architecture. The lead is a static harmonic/reed-like voicing. Keys sustain while held. The pad's Motion starts only with an explicit command.

A sound switch validates first, preserves completed notes/bars/BPM/monitor/octave/editor/treatment, resets held-key ownership, fades the old output for 15 ms before replacing shared settings, then fades in over 30 ms. An unfinished recording blocks a switch rather than discarding the take. Shape histories are replaced. Full Session/Open remains a deliberately separate whole-workspace restore.

Authored trim (-48…0 dB) is before output safety in live and offline production graphs. Temporary listening trim (-24…0 dB) is after safety, excluded from files. Rendered audition's monitor can attenuate its reference file; rerender to increase above that reference. Escape/blur also stop rendered audio and invalidate pending results. Offline cancellation no longer tries to call unsupported `OfflineAudioContext.close()`.

## Evidence

- 178 synth/DOM/contract tests pass (170 existing plus 8 focused groups covering many invalid-input cases); 94 string-study tests pass.
- TypeScript check and production build pass. The main bundle is about 582 kB uncompressed / 190 kB gzip because the four canonical sample arrays are embedded. Vite emits its >500 kB advisory; the single-bundle design is retained.
- Chromium **153.0.8010.0**: existing phrase suite, 20 new render assertions, 17 browser/UI checks, including actual production-bundle load and demo playback. Desktop and 390 px screenshots inspected. No page exceptions.
- Real UI: search, role loading, favorites, blind labels, Save as new, rename, duplicate, malformed file rejection, static audition, Motion WAV export, reload persistence; keyboard ownership checked through the production performance stream while switching sounds.
- Four static role phrases rendered and WAV PCM decoded sample-exactly. Pad Motion round-trip rerender is sample-identical. Explicit Motion differs from static. Authored -6 dB trim produces the expected amplitude ratio. All leading rests and tails retained.
- Twelve-voice chords rendered for all four patches at monitor 1. Peaks 0.287–0.328, below the 0.85 safety knee in these fixtures. This is evidence for the tested chords, not a universal bound on every edit.
- Mono fold-down RMS / stereo-channel RMS: bass/lead 1.000, keys 0.995, pad 0.962 static / 0.962 Motion; no large cancellation in the fixtures. These do not establish perceptual stereo quality.
- Rapid held-note sound switching was captured in Chromium; no stuck ownership, bounded peak/adjacent-sample change, subsequent key press audible. See JSON for actual measurements.

| Role | Static peak | Static RMS | Authored trim | Primary range |
|---|---:|---:|---:|---|
| Bass | 0.0762 | 0.0362 | -3 dB | MIDI 28–52 |
| Keys | 0.1291 | 0.0322 | -3 dB | MIDI 48–84 |
| Lead | 0.0602 | 0.0295 | -4 dB | MIDI 60–88 |
| Pad | 0.1251 | 0.0297 | -4 dB | MIDI 48–79 |

Measurements are [render-checks.json](render-checks.json), [phrase-checks.json](phrase-checks.json) and [browser-checks.json](browser-checks.json). Screenshots: [desktop](library-desktop.png), [phone](library-phone.png). Raw audition audio is in the separately delivered `phosphor-starter-auditions.zip`.

## Reproduce

```sh
npm ci
npm run test:synth
npm run test:string-lab
npm run typecheck
npm run build
npm run presets:validate -- src/presets/starter.pack.json
# Install Playwright's browser once, or point CHROMIUM_PATH at an installed Chromium.
npx playwright install chromium
npm run test:presets:browser
```

The browser runner starts its own local dev and production-preview servers and writes evidence to `/tmp/phosphor-preset-qa` (override `QA_OUTPUT`). `npm run presets:kit` builds the neutral zip from committed source and records its SHA and per-file DSP hashes. The zip contains a single neutral example in place of the proof bank and excludes git history, reveal and other banks. It can run independently after `npm ci`.

## Listening and limits

Headless Chromium rendered and exercised playback; no human musical listening, physical keyboard performance, Safari, iPhone or speaker audition was done. The browser is not an acoustic judge. Shared Motion runs at 30 Hz; ordinary live playback and 48 kHz offline rendering do not have identical clocks/phases, and Space differs across sample rates. Static demos disable shared Motion but retain Chorus modulation. The phrase WAV path is provisional with respect to live equivalence; it is not #16's seamless-loop exporter.

Next authorized human step is the [five-minute audition](AUDITION.md). Each later author receives the same [neutral brief](../../contributor-kit/README.md), independently supplies six sounds, and only after listening may add up to two complementary sounds. The four proof sounds are not a recommended final bank.
