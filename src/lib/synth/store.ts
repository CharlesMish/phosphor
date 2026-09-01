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
  buildSpaceView,
  cloneContour,
  contoursDiffer,
  generateSpaceContour,
  type SpacePreset,
} from "./space";
import {
  DEFAULT_MOTION_BEATS,
  DEFAULT_MOTION_BPM,
  DEFAULT_MOTION_MODE,
  MOTION_BEAT_LENGTHS,
  clampMotionBpm,
  cloneMotionPath,
  complementMotionPath,
  createDefaultMotionPath,
  motionPathsDiffer,
  sampleMotionPath,
  type MotionBeats,
  type MotionMode,
} from "./motion";

export type { WavePreset, SpacePreset };

export type EditorDomain = "cycle" | "motion" | "space";

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
  motionPath: number[];
  motionPlaying: boolean;
  motionProgress: number;
  motionRunId: number;
  motionBpm: number;
  motionBeats: MotionBeats;
  motionMode: MotionMode;
  motionPast: number[][];
  motionFuture: number[][];
  past: number[][];
  future: number[][];
  spaceContour: number[];
  spaceView: number[];
  spaceSeed: number;
  spacePreset: SpacePreset | "custom";
  /** Metal modes are processing state, independent of whether the contour is still the preset shape. */
  spaceMetal: boolean;
  spaceMix: number;
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
  auditionMotion: (t: number, immediate?: boolean) => void;
  setLiveMotionPath: (path: number[]) => void;
  finishMotionGesture: (before: number[], after: number[]) => void;
  playMotion: () => void;
  stopMotion: () => void;
  setMotionBpm: (bpm: number) => void;
  setMotionBeats: (beats: MotionBeats) => void;
  setMotionMode: (mode: MotionMode) => void;
  setMotionPlaybackPosition: (
    t: number,
    progress: number,
    complete: boolean,
    runId: number,
  ) => void;
  undo: () => void;
  redo: () => void;
  setLiveContour: (contour: number[]) => void;
  finishSpaceGesture: (before: number[], after: number[]) => void;
  applySpacePreset: (preset: SpacePreset) => void;
  scatterSpace: () => void;
  setSpaceMix: (mix: number) => void;
  setParam: (key: keyof SynthParams, value: number) => void;
  setOctave: (octave: number) => void;
  setActiveNotes: (notes: number[]) => void;
  setAudioReady: (ready: boolean) => void;
  markDrawn: () => void;
  markSpaceDrawn: () => void;
};

const initialSamples = generatePreset("sine");
const initialMotionPath = createDefaultMotionPath();
const initialContour = generateSpaceContour("room");
const initialSeed = INITIAL_SPACE_SEED;

function pushPast(past: number[][], snapshot: number[]): number[][] {
  const next = [...past, cloneWave(snapshot)];
  if (next.length > HISTORY_LIMIT) next.splice(0, next.length - HISTORY_LIMIT);
  return next;
}

function pushMotionPast(past: number[][], snapshot: number[]): number[][] {
  const next = [...past, cloneMotionPath(snapshot)];
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

function applySpace(contour: number[], seed: number, metal: boolean) {
  synth.setSpace(contour, seed, metal);
}

export const useSynthStore = create<SynthState & SynthActions>((set, get) => {
  type MorphSource = "manual" | "motion-drawing" | "motion-playback";

  const applyMorphPosition = (
    t: number,
    source: MorphSource,
    immediate = false,
    motionState: Partial<SynthState> = {},
  ) => {
    const { slotA, slotB, morphLive, samples: prev } = get();
    if (!slotA || !slotB) return false;
    const u = Math.min(1, Math.max(0, t));
    const samples = morphSamples(slotA, slotB, u);
    const recordCycleHistory = source === "manual";
    const reengage = recordCycleHistory && !morphLive && wavesDiffer(prev, samples);
    set({
      morph: u,
      samples,
      preset: "custom",
      hasDrawn: true,
      morphLive: true,
      ...(source !== "motion-playback" ? { motionPlaying: false } : {}),
      ...(reengage ? { past: pushPast(get().past, prev), future: [] } : {}),
      ...motionState,
    });
    synth.setWaveform(samples, immediate);
    return true;
  };

  return {
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
  motionPath: initialMotionPath,
  motionPlaying: false,
  motionProgress: 0,
  motionRunId: 0,
  motionBpm: DEFAULT_MOTION_BPM,
  motionBeats: DEFAULT_MOTION_BEATS,
  motionMode: DEFAULT_MOTION_MODE,
  motionPast: [],
  motionFuture: [],
  past: [],
  future: [],
  spaceContour: initialContour,
  spaceView: buildSpaceView(initialContour, initialSeed),
  spaceSeed: initialSeed,
  spacePreset: "room",
  spaceMetal: false,
  spaceMix: INITIAL_SPACE_MIX,
  spaceHasDrawn: false,
  spacePast: [],
  spaceFuture: [],

  setDomain: (domain) => {
    set({ domain });
    synth.unlock();
  },

  setLiveSamples: (samples, immediate = false) => {
    set({ samples, preset: "custom", morphLive: false, motionPlaying: false });
    synth.setWaveform(samples, immediate);
  },

  commitSamples: (samples, preset = "custom") => {
    const prev = get().samples;
    if (!wavesDiffer(prev, samples)) {
      set({ samples, preset, hasDrawn: true, morphLive: false, motionPlaying: false });
      synth.setWaveform(samples, true);
      return;
    }
    set({
      samples,
      preset,
      hasDrawn: true,
      morphLive: false,
      motionPlaying: false,
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
      motionPlaying: false,
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
    set({
      slotA: samples,
      morph: 0,
      hasDrawn: true,
      morphLive: Boolean(get().slotB),
      motionPlaying: false,
    });
  },
  captureB: () => {
    const samples = cloneWave(get().samples);
    set({
      slotB: samples,
      morph: 1,
      hasDrawn: true,
      morphLive: Boolean(get().slotA),
      motionPlaying: false,
    });
  },
  swapSlots: () => {
    const { slotA, slotB, morph, motionPath, motionPast, motionFuture } = get();
    set({
      slotA: slotB ? cloneWave(slotB) : null,
      slotB: slotA ? cloneWave(slotA) : null,
      morph: 1 - morph,
      motionPath: complementMotionPath(motionPath),
      motionPast: motionPast.map(complementMotionPath),
      motionFuture: motionFuture.map(complementMotionPath),
      motionPlaying: false,
    });
  },
  setMorph: (t, immediate = false) => {
    applyMorphPosition(t, "manual", immediate);
  },

  auditionMotion: (t, immediate = false) => {
    applyMorphPosition(t, "motion-drawing", immediate);
  },

  setLiveMotionPath: (path) => {
    set({ motionPath: path });
  },

  finishMotionGesture: (before, after) => {
    const changed = motionPathsDiffer(before, after);
    set({
      motionPath: after,
      ...(changed
        ? { motionPast: pushMotionPast(get().motionPast, before), motionFuture: [] }
        : {}),
    });
  },

  playMotion: () => {
    const { slotA, slotB, motionPath, motionRunId } = get();
    if (!slotA || !slotB) return;
    synth.unlock();
    const nextRunId = motionRunId + 1;
    applyMorphPosition(sampleMotionPath(motionPath, 0), "motion-playback", true, {
      motionPlaying: true,
      motionProgress: 0,
      motionRunId: nextRunId,
    });
  },

  stopMotion: () => set({ motionPlaying: false }),

  setMotionBpm: (bpm) => set({ motionBpm: clampMotionBpm(bpm) }),
  setMotionBeats: (beats) => {
    if (MOTION_BEAT_LENGTHS.includes(beats)) set({ motionBeats: beats });
  },
  setMotionMode: (mode) => set({ motionMode: mode }),

  setMotionPlaybackPosition: (t, progress, complete, runId) => {
    const state = get();
    if (!state.motionPlaying || state.motionRunId !== runId) return;
    applyMorphPosition(t, "motion-playback", complete, {
      motionProgress: Math.min(1, Math.max(0, progress)),
      ...(complete ? { motionPlaying: false } : {}),
    });
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
    const { spaceSeed, spacePreset, spaceMetal, spacePast } = get();
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
    applySpace(after, spaceSeed, spaceMetal);
  },

  applySpacePreset: (preset) => {
    const { spaceContour, spaceSeed, spacePreset, spaceMetal, spacePast } = get();
    const next = generateSpaceContour(preset);
    const nextMetal = preset === "metal";
    if (!contoursDiffer(spaceContour, next) && spacePreset === preset) {
      set({ spacePreset: preset, spaceMetal: nextMetal, spaceHasDrawn: true });
      applySpace(next, spaceSeed, nextMetal);
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
    applySpace(next, spaceSeed, nextMetal);
  },

  scatterSpace: () => {
    const { spaceContour, spaceSeed, spacePreset, spaceMetal, spacePast } = get();
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
    applySpace(spaceContour, seed, spaceMetal);
  },

  setSpaceMix: (mix) => {
    const next = Math.min(1, Math.max(0, mix));
    set({ spaceMix: next });
    synth.setSpaceMix(next);
    synth.unlock();
  },

  undo: () => {
    if (get().domain === "motion") {
      const { motionPast, motionPath, motionFuture } = get();
      const prev = motionPast[motionPast.length - 1];
      if (!prev) {
        set({ motionPlaying: false });
        return;
      }
      set({
        motionPath: cloneMotionPath(prev),
        motionPast: motionPast.slice(0, -1),
        motionFuture: [...motionFuture, cloneMotionPath(motionPath)],
        motionPlaying: false,
      });
      return;
    }
    if (get().domain === "space") {
      const {
        spacePast,
        spaceContour,
        spaceSeed,
        spacePreset,
        spaceMetal,
        spaceFuture,
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
      applySpace(prev.contour, prev.seed, prev.metal);
      return;
    }
    const { past, samples, future } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({
      samples: cloneWave(prev),
      preset: "custom",
      morphLive: false,
      motionPlaying: false,
      past: past.slice(0, -1),
      future: [...future, cloneWave(samples)],
    });
    synth.setWaveform(prev, true);
  },
  redo: () => {
    if (get().domain === "motion") {
      const { motionFuture, motionPath, motionPast } = get();
      const next = motionFuture[motionFuture.length - 1];
      if (!next) {
        set({ motionPlaying: false });
        return;
      }
      set({
        motionPath: cloneMotionPath(next),
        motionFuture: motionFuture.slice(0, -1),
        motionPast: pushMotionPast(motionPast, motionPath),
        motionPlaying: false,
      });
      return;
    }
    if (get().domain === "space") {
      const {
        spaceFuture,
        spaceContour,
        spaceSeed,
        spacePreset,
        spaceMetal,
        spacePast,
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
      applySpace(next.contour, next.seed, next.metal);
      return;
    }
    const { future, samples, past } = get();
    const next = future[future.length - 1];
    if (!next) return;
    set({
      samples: cloneWave(next),
      preset: "custom",
      morphLive: false,
      motionPlaying: false,
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
  };
});

synth.setWaveform(cloneWave(initialSamples), true);
synth.setSpace(cloneContour(initialContour), initialSeed, false);
synth.setSpaceMix(INITIAL_SPACE_MIX);
