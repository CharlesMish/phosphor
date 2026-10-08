# Bow experiment

Move horizontally to supply energy to one A3 (220 Hz) voice. Moving vertically
changes **silk / grain**, a synthetic harmonic-balance and friction-noise control.
No touch-pressure measurement is used. Hold left/right arrows for an accessible
continuous stroke; up/down adjusts grain.

## Implementation and limits

The engine is a deliberately synthetic harmonic resonator with ten phase-continuous
modes. Movement feeds each mode's amplitude. Higher modes fade faster, and stillness
or release lets the existing energy decay. Grain opens upper harmonics and adds a
small filtered deterministic noise component. Parameter smoothing lives in DSP.
This is **not a nonlinear stick-slip model or an accurate violin simulation**.

The view measures horizontal pointer speed, smooths event noise, and lets stale
movement fall to zero within 140 ms even when no further pointer events arrive.
The engine independently stops adding energy if control messages stop for 140 ms.
These are separate safeguards: a lost view/event stream cannot leave a sustained
drone. Releasing a pointer ends contact; cancellation clears the captured gesture.
The shared host owns hard Stop, switching, page backgrounding, and output fading.

Commands:

```js
{type: 'bow', active: true, speed: 0.0 /*..1*/, roughness: 0.0 /*..1*/}
{type: 'bow', active: false, speed: 0, roughness: 0.4}
{type: 'stop'}
{type: 'reset'}
```

Continuous movement commands should refresh faster than the 140 ms watchdog.
`view.mjs` exports a 9.4-second demonstration through the same command interface:
slow stroke, stronger reversed stroke, rough/strong stroke, stationary contact,
release. It can be interrupted by the shared shell.

## Evidence

`node --test scripts/string-lab/bow.test.mjs`: 12/12 checks pass, covering both
44.1 and 48 kHz. Checks render actual samples for graded movement energy, harmonic
contrast beyond overall gain, decay at rest/release, independent stale-stream
timeout, invalid input bounds, stop/reset, and the exported demonstration.

At 48 kHz, grain 0.4, sustained speed 0.08 / 0.4 / 0.9 gives RMS approximately
0.0346 / 0.1089 / 0.1900 and peak 0.0514 / 0.1606 / 0.2747. These verify a useful
continuous output range, not human judgments of bow feel or musical quality.
Actual iPhone Safari and Charlie's speaker/listening test remain human checks.
