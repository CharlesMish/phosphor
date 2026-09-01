import { create } from "zustand";
import { synth, type SynthParams } from "./engine";
import {
  cloneWave,
  generatePreset,
  invertWave,
  lerpWaves,
  mirrorWave,
  normalizeWave,
  smoothWave,
  wavesDiffer,
  type WavePreset,
} from "./waveform";
import {
  INITIAL_SPACE_SEED,
  SPACE_DEFAULT_SECONDS,
  buildSpaceView,
  clampSpaceSeconds,
  cloneContour,
  contoursDiffer,
  generateSpaceContour,
  type SpacePreset,
} from "./space";

export type { WavePreset, SpacePreset };

export type EditorDomain = "cycle" | "space";

const HISTORY_LIMIT = 32;
const INITIAL_SPACE_MIX = 0.38;

type SpaceSnap = {
  contour: number[];
  seed: number;
  preset: SpacePreset | "custom";
  metal: boolean;
};

type SynthState = {
  domain: EditorDomain;
  samples: number[];
  preset: WavePreset | "custom";
  attack: number;
  release: number;
  volume: number;
  cutoff: number;
  octave: number;
  activeNotes: number[];
  audioReady: boolean;
  hasDrawn: boolean;
  slotA: number[] | null;
  slotB: number[] | null;
  morph: number;
  morphLive: boolean;
  past: number[][];
  future: number[][];
  spaceContour: number[];
  spaceView: number[];
  spaceSeed: number;
  spacePreset: SpacePreset | "custom";
  /** Metal modes are processing state, independent of whether the contour is still the preset shape. */
  spaceMetal: boolean;
  spaceMix: number;
  spaceSeconds: number;
  spaceHasDrawn: boolean;
  spacePast: SpaceSnap[];
  spaceFuture: SpaceSnap[];
};

type SynthActions = {
  setDomain: (domain: EditorDomain) => void;
  setLiveSamples: (samples: number[], immediate?: boolean) => void;
  commitSamples: (samples: number[], preset?: WavePreset | "custom") => void;
  finishGesture: (before: number[], after: number[]) => void;
  applyPreset: (preset: WavePreset) => void;
  resetWave: () => void;
  smooth: () => void;
  normalize: () => void;
  invert: () => void;
  randomize: () => void;
  mirror: () => void;
  captureA: () => void;
  captureB: () => void;
  swapSlots: () => void;
  setMorph: (t: number, immediate?: boolean) => void;
  undo: () => void;
  redo: () => void;
  setLiveContour: (contour: number[]) => void;
  finishSpaceGesture: (before: number[], after: number[]) => void;
  applySpacePreset: (preset: SpacePreset) => void;
  scatterSpace: () => void;
  setSpaceMix: (mix: number) => void;
  setSpaceLength: (seconds: number) => void;
  commitSpaceLength: (seconds: number) => void;
  setParam: (key: keyof SynthParams, value: number) => void;
  setOctave: (octave: number) => void;
  setActiveNotes: (notes: number[]) => void;
  setAudioReady: (ready: boolean) => void;
  markDrawn: () => void;
  markSpaceDrawn: () => void;
};

const initialSamples = generatePreset("sine");
const initialContour = generateSpaceContour("room");
const initialSeed = INITIAL_SPACE_SEED;

function pushPast(past: number[][], snapshot: number[]): number[][] {
  const next = [...past, cloneWave(snapshot)];
  if (next.length > HISTORY_LIMIT) next.splice(0, next.length - HISTORY_LIMIT);
  return next;
}

function pushSpacePast(past: SpaceSnap[], snap: SpaceSnap): SpaceSnap[] {
  const next = [
    ...past,
    {
      contour: cloneContour(snap.contour),
      seed: snap.seed,
      preset: snap.preset,
      metal: snap.metal,
    },
  ];
  if (next.length > HISTORY_LIMIT) next.splice(0, next.length - HISTORY_LIMIT);
  return next;
}

function morphSamples(slotA: number[], slotB: number[], t: number): number[] {
  const u = Math.min(1, Math.max(0, t));
  if (u <= 0) return cloneWave(slotA);
  if (u >= 1) return cloneWave(slotB);
  return normalizeWave(lerpWaves(slotA, slotB, u), 0.92);
}

function applySpace(contour: number[], seed: number, metal: boolean, seconds: number) {
  synth.setSpace(contour, seed, metal, seconds);
}

export const useSynthStore = create<SynthState & SynthActions>((set, get) => ({
  domain: "cycle",
  samples: initialSamples,
  preset: "sine",
  attack: 0.04,
  release: 0.28,
  volume: 0.72,
  cutoff: 1,
  octave: 0,
  activeNotes: [],
  audioReady: false,
  hasDrawn: false,
  slotA: null,
  slotB: null,
  morph: 0,
  morphLive: false,
  past: [],
  future: [],
  spaceContour: initialContour,
  spaceView: buildSpaceView(initialContour, initialSeed),
  spaceSeed: initialSeed,
  spacePreset: "room",
  spaceMetal: false,
  spaceMix: INITIAL_SPACE_MIX,
  spaceSeconds: SPACE_DEFAULT_SECONDS,
  spaceHasDrawn: false,
  spacePast: [],
  spaceFuture: [],

  setDomain: (domain) => {
    set({ domain });
    synth.unlock();
  },

  setLiveSamples: (samples, immediate = false) => {
    set({ samples, preset: "custom", morphLive: false });
    synth.setWaveform(samples, immediate);
  },

  commitSamples: (samples, preset = "custom") => {
    const prev = get().samples;
    if (!wavesDiffer(prev, samples)) {
      set({ samples, preset, hasDrawn: true, morphLive: false });
      synth.setWaveform(samples, true);
      return;
    }
    set({
      samples,
      preset,
      hasDrawn: true,
      morphLive: false,
      past: pushPast(get().past, prev),
      future: [],
    });
    synth.setWaveform(samples, true);
  },

  finishGesture: (before, after) => {
    const changed = wavesDiffer(before, after);
    set({
      samples: after,
      preset: "custom",
      hasDrawn: true,
      morphLive: false,
      ...(changed ? { past: pushPast(get().past, before), future: [] } : {}),
    });
    synth.setWaveform(after, true);
  },

  applyPreset: (preset) => {
    get().commitSamples(generatePreset(preset), preset);
  },
  resetWave: () => {
    get().commitSamples(generatePreset("sine"), "sine");
  },
  smooth: () => {
    get().commitSamples(smoothWave(get().samples, 1));
  },
  normalize: () => {
    get().commitSamples(normalizeWave(get().samples, 0.92));
  },
  invert: () => {
    get().commitSamples(invertWave(get().samples));
  },
  randomize: () => {
    get().commitSamples(generatePreset("wild"), "wild");
  },
  mirror: () => {
    get().commitSamples(mirrorWave(get().samples));
  },

  captureA: () => {
    const samples = cloneWave(get().samples);
    set({ slotA: samples, morph: 0, hasDrawn: true, morphLive: Boolean(get().slotB) });
  },
  captureB: () => {
    const samples = cloneWave(get().samples);
    set({ slotB: samples, morph: 1, hasDrawn: true, morphLive: Boolean(get().slotA) });
  },
  swapSlots: () => {
    const { slotA, slotB, morph } = get();
    set({
      slotA: slotB ? cloneWave(slotB) : null,
      slotB: slotA ? cloneWave(slotA) : null,
      morph: 1 - morph,
    });
  },
  setMorph: (t, immediate = false) => {
    const { slotA, slotB, morphLive, samples: prev } = get();
    if (!slotA || !slotB) return;
    const u = Math.min(1, Math.max(0, t));
    const samples = morphSamples(slotA, slotB, u);
    const reengage = !morphLive && wavesDiffer(prev, samples);
    set({
      morph: u,
      samples,
      preset: "custom",
      hasDrawn: true,
      morphLive: true,
      ...(reengage ? { past: pushPast(get().past, prev), future: [] } : {}),
    });
    synth.setWaveform(samples, immediate);
  },

  setLiveContour: (contour) => {
    const { spaceSeed } = get();
    set({
      spaceContour: contour,
      spaceView: buildSpaceView(contour, spaceSeed),
      spaceHasDrawn: true,
    });
  },

  finishSpaceGesture: (before, after) => {
    const { spaceSeed, spacePreset, spaceMetal, spacePast, spaceSeconds } =
      get();
    const changed = contoursDiffer(before, after);
    set({
      spaceContour: after,
      spaceView: buildSpaceView(after, spaceSeed),
      spacePreset: "custom",
      spaceHasDrawn: true,
      ...(changed
        ? {
            spacePast: pushSpacePast(spacePast, {
              contour: before,
              seed: spaceSeed,
              preset: spacePreset,
              metal: spaceMetal,
            }),
            spaceFuture: [],
          }
        : {}),
    });
    // Editing changes the contour identity to custom, not the processing identity.
    // A Metal-derived space therefore keeps its modal resonators until the user
    // explicitly chooses a non-Metal preset.
    applySpace(after, spaceSeed, spaceMetal, spaceSeconds);
  },

  applySpacePreset: (preset) => {
    const {
      spaceContour,
      spaceSeed,
      spacePreset,
      spaceMetal,
      spacePast,
      spaceSeconds,
    } = get();
    const next = generateSpaceContour(preset);
    const nextMetal = preset === "metal";
    if (!contoursDiffer(spaceContour, next) && spacePreset === preset) {
      set({ spacePreset: preset, spaceMetal: nextMetal, spaceHasDrawn: true });
      applySpace(next, spaceSeed, nextMetal, spaceSeconds);
      return;
    }
    set({
      spaceContour: next,
      spaceView: buildSpaceView(next, spaceSeed),
      spacePreset: preset,
      spaceMetal: nextMetal,
      spaceHasDrawn: true,
      spacePast: pushSpacePast(spacePast, {
        contour: spaceContour,
        seed: spaceSeed,
        preset: spacePreset,
        metal: spaceMetal,
      }),
      spaceFuture: [],
    });
    applySpace(next, spaceSeed, nextMetal, spaceSeconds);
  },

  scatterSpace: () => {
    const {
      spaceContour,
      spaceSeed,
      spacePreset,
      spaceMetal,
      spacePast,
      spaceSeconds,
    } = get();
    const seed = (spaceSeed + 0x9e3779b9) >>> 0 || 1;
    set({
      spaceSeed: seed,
      spaceView: buildSpaceView(spaceContour, seed),
      spaceHasDrawn: true,
      spacePast: pushSpacePast(spacePast, {
        contour: spaceContour,
        seed: spaceSeed,
        preset: spacePreset,
        metal: spaceMetal,
      }),
      spaceFuture: [],
    });
    applySpace(spaceContour, seed, spaceMetal, spaceSeconds);
  },

  setSpaceMix: (mix) => {
    const next = Math.min(1, Math.max(0, mix));
    set({ spaceMix: next });
    synth.setSpaceMix(next);
    synth.unlock();
  },

  // Length is deliberately absent from SpaceSnap: it is a playback parameter,
  // not part of authored contour/seed/Metal history.
  setSpaceLength: (seconds) => {
    set({ spaceSeconds: clampSpaceSeconds(seconds) });
  },
  commitSpaceLength: (seconds) => {
    const spaceSeconds = clampSpaceSeconds(seconds);
    const { spaceContour, spaceSeed, spaceMetal } = get();
    set({ spaceSeconds });
    applySpace(spaceContour, spaceSeed, spaceMetal, spaceSeconds);
  },

  undo: () => {
    if (get().domain === "space") {
      const {
        spacePast,
        spaceContour,
        spaceSeed,
        spacePreset,
        spaceMetal,
        spaceFuture,
        spaceSeconds,
      } = get();
      const prev = spacePast[spacePast.length - 1];
      if (!prev) return;
      set({
        spaceContour: cloneContour(prev.contour),
        spaceSeed: prev.seed,
        spacePreset: prev.preset,
        spaceMetal: prev.metal,
        spaceView: buildSpaceView(prev.contour, prev.seed),
        spacePast: spacePast.slice(0, -1),
        spaceFuture: [
          ...spaceFuture,
          {
            contour: cloneContour(spaceContour),
            seed: spaceSeed,
            preset: spacePreset,
            metal: spaceMetal,
          },
        ],
      });
      applySpace(prev.contour, prev.seed, prev.metal, spaceSeconds);
      return;
    }
    const { past, samples, future } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({
      samples: cloneWave(prev),
      preset: "custom",
      morphLive: false,
      past: past.slice(0, -1),
      future: [...future, cloneWave(samples)],
    });
    synth.setWaveform(prev, true);
  },
  redo: () => {
    if (get().domain === "space") {
      const {
        spaceFuture,
        spaceContour,
        spaceSeed,
        spacePreset,
        spaceMetal,
        spacePast,
        spaceSeconds,
      } = get();
      const next = spaceFuture[spaceFuture.length - 1];
      if (!next) return;
      set({
        spaceContour: cloneContour(next.contour),
        spaceSeed: next.seed,
        spacePreset: next.preset,
        spaceMetal: next.metal,
        spaceView: buildSpaceView(next.contour, next.seed),
        spaceFuture: spaceFuture.slice(0, -1),
        spacePast: pushSpacePast(spacePast, {
          contour: spaceContour,
          seed: spaceSeed,
          preset: spacePreset,
          metal: spaceMetal,
        }),
      });
      applySpace(next.contour, next.seed, next.metal, spaceSeconds);
      return;
    }
    const { future, samples, past } = get();
    const next = future[future.length - 1];
    if (!next) return;
    set({
      samples: cloneWave(next),
      preset: "custom",
      morphLive: false,
      future: future.slice(0, -1),
      past: pushPast(past, samples),
    });
    synth.setWaveform(next, true);
  },

  setParam: (key, value) => {
    set({ [key]: value } as Partial<SynthState>);
    synth.setParams({ [key]: value });
    synth.unlock();
  },
  setOctave: (octave) => {
    const next = Math.min(3, Math.max(-2, octave));
    set({ octave: next });
  },
  setActiveNotes: (notes) => set({ activeNotes: notes }),
  setAudioReady: (ready) => set({ audioReady: ready }),
  markDrawn: () => set({ hasDrawn: true }),
  markSpaceDrawn: () => set({ spaceHasDrawn: true }),
}));

synth.setWaveform(cloneWave(initialSamples), true);
synth.setSpace(cloneContour(initialContour), initialSeed, false, SPACE_DEFAULT_SECONDS);
synth.setSpaceMix(INITIAL_SPACE_MIX);
