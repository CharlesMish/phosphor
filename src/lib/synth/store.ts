import { create } from "zustand";
import {
  OSCILLATOR_SAMPLE_TARGET,
  cycleMorphSamples,
  synth,
  type SynthParams,
} from "./engine";
import {
  cloneWave,
  generatePreset,
  invertWave,
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
import {
  DRIVE_DEFAULT_AMOUNT,
  DRIVE_DEFAULT_SAFE,
  DRIVE_SAFE_MAX_AMOUNT,
  clampDriveAmount,
  cloneTransfer,
  generateDrivePreset,
  identifyDrivePreset,
  transfersDiffer,
  type DrivePreset,
} from "./drive";
import {
  CHORUS_DEFAULT_PERIOD,
  chorusCurvesDiffer,
  cloneChorusCurve,
  generateChorusPreset,
  identifyChorusPreset,
  type ChorusPreset,
} from "./chorus";
import {
  DEFAULT_MOTION_ROUTES,
  DEFAULT_MOTION_BEATS,
  DEFAULT_MOTION_BPM,
  DEFAULT_MOTION_MODE,
  MOTION_BEAT_LENGTHS,
  clampMotionBpm,
  clampMotionValue,
  cloneMotionPath,
  cloneMotionRoutes,
  createMotionRunSnapshot,
  createDefaultMotionPath,
  hasPlayableMotionRoute,
  mapMotionValue,
  motionCycleMorph,
  motionPathsDiffer,
  sampleMotionPath,
  type MotionBeats,
  type MotionMode,
  type MotionNumericRouteId,
  type MotionRouteEndpoint,
  type MotionRouteId,
  type MotionRoutes,
  type MotionRunSnapshot,
} from "./motion";

export type { WavePreset, SpacePreset, DrivePreset, ChorusPreset };

export type EditorDomain = "cycle" | "motion" | "drive" | "chorus" | "space";

const HISTORY_LIMIT = 32;
const INITIAL_SPACE_MIX = 0.38;

type SpaceSnap = {
  contour: number[];
  seed: number;
  preset: SpacePreset | "custom";
  metal: boolean;
};

type DriveSnap = {
  curve: number[];
  preset: DrivePreset | "custom";
};

type ChorusSnap = {
  curve: number[];
  preset: ChorusPreset | "custom";
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
  motionValue: number;
  motionRunId: number;
  motionRun: MotionRunSnapshot | null;
  motionBpm: number;
  motionBeats: MotionBeats;
  motionMode: MotionMode;
  motionRoutes: MotionRoutes;
  motionPast: number[][];
  motionFuture: number[][];
  past: number[][];
  future: number[][];
  driveCurve: number[];
  drivePreset: DrivePreset | "custom";
  driveAmount: number;
  driveSafe: boolean;
  driveHasDrawn: boolean;
  drivePast: DriveSnap[];
  driveFuture: DriveSnap[];
  chorusCurve: number[];
  chorusPreset: ChorusPreset | "custom";
  chorusPeriod: number;
  chorusMix: number;
  chorusPast: ChorusSnap[];
  chorusFuture: ChorusSnap[];
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
  auditionMotion: (t: number, immediate?: boolean) => void;
  setLiveMotionPath: (path: number[]) => void;
  finishMotionGesture: (before: number[], after: number[]) => void;
  playMotion: () => void;
  stopMotion: () => void;
  setMotionBpm: (bpm: number) => void;
  setMotionBeats: (beats: MotionBeats) => void;
  setMotionMode: (mode: MotionMode) => void;
  setMotionRouteEnabled: (route: MotionRouteId, enabled: boolean) => void;
  setMotionRouteEndpoint: (
    route: MotionNumericRouteId,
    endpoint: MotionRouteEndpoint,
    value: number,
  ) => void;
  setMotionPlaybackPosition: (
    t: number,
    progress: number,
    complete: boolean,
    runId: number,
  ) => void;
  undo: () => void;
  redo: () => void;
  setLiveDrive: (curve: number[]) => void;
  finishDriveGesture: (before: number[], after: number[]) => void;
  applyDrivePreset: (preset: DrivePreset) => void;
  setDriveAmount: (amount: number) => void;
  setDriveSafe: (safe: boolean) => void;
  setLiveChorus: (curve: number[]) => void;
  finishChorusGesture: (before: number[], after: number[]) => void;
  applyChorusPreset: (preset: ChorusPreset) => void;
  setChorusPeriod: (period: number) => void;
  setChorusMix: (mix: number) => void;
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
const initialMotionPath = createDefaultMotionPath();
const initialDriveCurve = generateDrivePreset("identity");
const initialChorusCurve = generateChorusPreset("sine");
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

function pushDrivePast(past: DriveSnap[], snap: DriveSnap): DriveSnap[] {
  const next = [
    ...past,
    { curve: cloneTransfer(snap.curve), preset: snap.preset },
  ];
  if (next.length > HISTORY_LIMIT) next.splice(0, next.length - HISTORY_LIMIT);
  return next;
}

function pushChorusPast(past: ChorusSnap[], snap: ChorusSnap): ChorusSnap[] {
  const next = [
    ...past,
    { curve: cloneChorusCurve(snap.curve), preset: snap.preset },
  ];
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
  return cycleMorphSamples(slotA, slotB, t);
}

function applySpace(contour: number[], seed: number, metal: boolean, seconds: number) {
  synth.setSpace(contour, seed, metal, seconds);
}

function applyDrive(
  curve: number[],
  amount: number,
  safe: boolean,
  smoothAmount = false,
) {
  synth.setDriveState(curve, amount, safe, smoothAmount);
}

export const useSynthStore = create<SynthState & SynthActions>((set, get) => {
  const motionRouteIsWriting = (
    state: SynthState,
    route: MotionRouteId,
  ): boolean => {
    if (!state.motionPlaying || !state.motionRun) return false;
    if (route === "cycle") {
      return state.motionRun.cycleAvailable && state.motionRun.routes.cycle.enabled;
    }
    return state.motionRun.routes[route].enabled;
  };

  const applyManualMorphPosition = (
    t: number,
    immediate = false,
  ) => {
    const state = get();
    const { slotA, slotB, morphLive, samples: prev } = state;
    if (!slotA || !slotB) return false;
    const u = clampMotionValue(t);
    const samples = morphSamples(slotA, slotB, u);
    const audiblePrevious = normalizeWave(prev, OSCILLATOR_SAMPLE_TARGET);
    const reengage = !morphLive && wavesDiffer(audiblePrevious, samples);
    set({
      morph: u,
      samples,
      preset: "custom",
      hasDrawn: true,
      morphLive: true,
      ...(motionRouteIsWriting(state, "cycle")
        ? { motionPlaying: false }
        : {}),
      ...(reengage ? { past: pushPast(get().past, prev), future: [] } : {}),
    });
    synth.setCycleMorph(slotA, slotB, u, immediate);
    return true;
  };

  const applyMotionSource = (
    value: number,
    routes: MotionRoutes,
    cycleAvailable: boolean,
    immediate = false,
    motionState: Partial<SynthState> = {},
  ) => {
    const state = get();
    const m = clampMotionValue(value);
    const nextState: Partial<SynthState> = {
      motionValue: m,
      ...motionState,
    };
    let cycleSamples: number[] | null = null;
    let cycleMorphValue: number | null = null;
    let nextDriveAmount: number | null = null;
    let nextChorusMix: number | null = null;
    let nextSpaceMix: number | null = null;

    if (routes.cycle.enabled && cycleAvailable && state.slotA && state.slotB) {
      const morph = motionCycleMorph(m, routes.cycle.inverted);
      cycleMorphValue = morph;
      cycleSamples = morphSamples(state.slotA, state.slotB, morph);
      Object.assign(nextState, {
        morph,
        samples: cycleSamples,
        preset: "custom" as const,
        hasDrawn: true,
        morphLive: true,
      });
    }

    if (routes.driveAmount.enabled) {
      const routed = clampDriveAmount(
        mapMotionValue(
          m,
          routes.driveAmount.from,
          routes.driveAmount.to,
        ),
      );
      nextDriveAmount = state.driveSafe
        ? Math.min(DRIVE_SAFE_MAX_AMOUNT, routed)
        : routed;
      nextState.driveAmount = nextDriveAmount;
    }

    if (routes.chorusMix.enabled) {
      nextChorusMix = mapMotionValue(
        m,
        routes.chorusMix.from,
        routes.chorusMix.to,
      );
      nextState.chorusMix = nextChorusMix;
    }

    if (routes.spaceMix.enabled) {
      nextSpaceMix = mapMotionValue(
        m,
        routes.spaceMix.from,
        routes.spaceMix.to,
      );
      nextState.spaceMix = nextSpaceMix;
    }

    set(nextState);
    if (
      cycleSamples &&
      cycleMorphValue !== null &&
      state.slotA &&
      state.slotB
    ) {
      synth.setCycleMorph(
        state.slotA,
        state.slotB,
        cycleMorphValue,
        immediate,
      );
    }
    if (nextDriveAmount !== null) {
      applyDrive(state.driveCurve, nextDriveAmount, state.driveSafe);
    }
    if (nextChorusMix !== null) synth.setChorusMix(nextChorusMix);
    if (nextSpaceMix !== null) synth.setSpaceMix(nextSpaceMix);
    return hasPlayableMotionRoute(routes, cycleAvailable);
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
  motionValue: initialMotionPath[0] ?? 0,
  motionRunId: 0,
  motionRun: null,
  motionBpm: DEFAULT_MOTION_BPM,
  motionBeats: DEFAULT_MOTION_BEATS,
  motionMode: DEFAULT_MOTION_MODE,
  motionRoutes: cloneMotionRoutes(DEFAULT_MOTION_ROUTES),
  motionPast: [],
  motionFuture: [],
  past: [],
  future: [],
  driveCurve: initialDriveCurve,
  drivePreset: "identity",
  driveAmount: DRIVE_DEFAULT_AMOUNT,
  driveSafe: DRIVE_DEFAULT_SAFE,
  driveHasDrawn: false,
  drivePast: [],
  driveFuture: [],
  chorusCurve: initialChorusCurve,
  chorusPreset: "sine",
  chorusPeriod: CHORUS_DEFAULT_PERIOD,
  chorusMix: 0,
  chorusPast: [],
  chorusFuture: [],
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

  setLiveDrive: (curve) => {
    set({
      driveCurve: curve,
      drivePreset: "custom",
      driveHasDrawn: true,
    });
    // Keep pointer rendering/store state immediate while coalescing the costly
    // WaveShaper table assignment to the same cadence as CYCLE drawing.
    synth.setDriveCurve(curve, false);
  },

  finishDriveGesture: (before, after) => {
    const { drivePast, driveAmount, driveSafe } = get();
    const changed = transfersDiffer(before, after);
    set({
      driveCurve: after,
      drivePreset: "custom",
      driveHasDrawn: true,
      ...(changed
        ? {
            drivePast: pushDrivePast(drivePast, {
              curve: before,
              preset: identifyDrivePreset(before),
            }),
            driveFuture: [],
          }
        : {}),
    });
    applyDrive(after, driveAmount, driveSafe);
  },

  applyDrivePreset: (preset) => {
    const { driveCurve, drivePreset, drivePast, driveAmount, driveSafe } = get();
    const next = generateDrivePreset(preset);
    if (!transfersDiffer(driveCurve, next) && drivePreset === preset) {
      set({ drivePreset: preset, driveHasDrawn: true });
      applyDrive(next, driveAmount, driveSafe);
      return;
    }
    set({
      driveCurve: next,
      drivePreset: preset,
      driveHasDrawn: true,
      drivePast: pushDrivePast(drivePast, {
        curve: driveCurve,
        preset: drivePreset,
      }),
      driveFuture: [],
    });
    applyDrive(next, driveAmount, driveSafe);
  },

  setDriveAmount: (amount) => {
    const state = get();
    const { driveCurve, driveSafe } = state;
    const clamped = clampDriveAmount(amount);
    const next = driveSafe
      ? Math.min(DRIVE_SAFE_MAX_AMOUNT, clamped)
      : clamped;
    set({
      driveAmount: next,
      ...(motionRouteIsWriting(state, "driveAmount")
        ? { motionPlaying: false }
        : {}),
    });
    applyDrive(driveCurve, next, driveSafe);
    synth.unlock();
  },

  setDriveSafe: (safe) => {
    const state = get();
    const nextAmount = safe
      ? Math.min(DRIVE_SAFE_MAX_AMOUNT, state.driveAmount)
      : state.driveAmount;
    const smoothClamp =
      safe && !state.driveSafe && state.driveAmount > DRIVE_SAFE_MAX_AMOUNT;
    set({ driveSafe: safe, driveAmount: nextAmount });
    applyDrive(state.driveCurve, nextAmount, safe, smoothClamp);
    synth.unlock();
  },

  setLiveChorus: (curve) => {
    set({ chorusCurve: curve, chorusPreset: "custom" });
    synth.setChorusCurve(curve);
  },

  finishChorusGesture: (before, after) => {
    const changed = chorusCurvesDiffer(before, after);
    set({
      chorusCurve: after,
      chorusPreset: changed ? "custom" : identifyChorusPreset(before),
      ...(changed
        ? {
            chorusPast: pushChorusPast(get().chorusPast, {
              curve: before,
              preset: identifyChorusPreset(before),
            }),
            chorusFuture: [],
          }
        : {}),
    });
    synth.setChorusCurve(after);
  },

  applyChorusPreset: (preset) => {
    const { chorusCurve, chorusPreset, chorusPast } = get();
    const next = generateChorusPreset(preset);
    if (!chorusCurvesDiffer(chorusCurve, next) && chorusPreset === preset) {
      synth.setChorusCurve(next);
      return;
    }
    set({
      chorusCurve: next,
      chorusPreset: preset,
      chorusPast: pushChorusPast(chorusPast, {
        curve: chorusCurve,
        preset: chorusPreset,
      }),
      chorusFuture: [],
    });
    synth.setChorusCurve(next);
  },

  setChorusPeriod: (period) => {
    const next = Math.min(4, Math.max(0.25, period));
    set({ chorusPeriod: next });
    synth.setChorusPeriod(next);
  },

  setChorusMix: (mix) => {
    const state = get();
    const next = Math.min(1, Math.max(0, mix));
    set({
      chorusMix: next,
      ...(motionRouteIsWriting(state, "chorusMix")
        ? { motionPlaying: false }
        : {}),
    });
    synth.setChorusMix(next);
    synth.unlock();
  },

  setLiveSamples: (samples, immediate = false) => {
    const state = get();
    set({
      samples,
      preset: "custom",
      morphLive: false,
      ...(motionRouteIsWriting(state, "cycle")
        ? { motionPlaying: false }
        : {}),
    });
    synth.setWaveform(samples, immediate);
  },

  commitSamples: (samples, preset = "custom") => {
    const state = get();
    const prev = state.samples;
    const stopCycleMotion = motionRouteIsWriting(state, "cycle");
    if (!wavesDiffer(prev, samples)) {
      set({
        samples,
        preset,
        hasDrawn: true,
        morphLive: false,
        ...(stopCycleMotion ? { motionPlaying: false } : {}),
      });
      synth.setWaveform(samples, true);
      return;
    }
    set({
      samples,
      preset,
      hasDrawn: true,
      morphLive: false,
      ...(stopCycleMotion ? { motionPlaying: false } : {}),
      past: pushPast(get().past, prev),
      future: [],
    });
    synth.setWaveform(samples, true);
  },

  finishGesture: (before, after) => {
    const state = get();
    const changed = wavesDiffer(before, after);
    set({
      samples: after,
      preset: "custom",
      hasDrawn: true,
      morphLive: false,
      ...(motionRouteIsWriting(state, "cycle")
        ? { motionPlaying: false }
        : {}),
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
    const state = get();
    const samples = cloneWave(state.samples);
    set({
      slotA: samples,
      morph: 0,
      hasDrawn: true,
      morphLive: Boolean(get().slotB),
      ...(motionRouteIsWriting(state, "cycle")
        ? { motionPlaying: false }
        : {}),
    });
  },
  captureB: () => {
    const state = get();
    const samples = cloneWave(state.samples);
    set({
      slotB: samples,
      morph: 1,
      hasDrawn: true,
      morphLive: Boolean(get().slotA),
      ...(motionRouteIsWriting(state, "cycle")
        ? { motionPlaying: false }
        : {}),
    });
  },
  swapSlots: () => {
    const state = get();
    const { slotA, slotB, morph, motionRoutes } = state;
    set({
      slotA: slotB ? cloneWave(slotB) : null,
      slotB: slotA ? cloneWave(slotA) : null,
      morph: 1 - morph,
      motionRoutes: {
        ...motionRoutes,
        cycle: {
          ...motionRoutes.cycle,
          inverted: !motionRoutes.cycle.inverted,
        },
      },
      ...(motionRouteIsWriting(state, "cycle")
        ? { motionPlaying: false }
        : {}),
    });
  },
  setMorph: (t, immediate = false) => {
    applyManualMorphPosition(t, immediate);
  },

  auditionMotion: (t, immediate = false) => {
    const state = get();
    applyMotionSource(
      t,
      state.motionRoutes,
      Boolean(state.slotA && state.slotB),
      immediate,
      state.motionPlaying ? { motionPlaying: false } : {},
    );
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
    const state = get();
    const cycleAvailable = Boolean(state.slotA && state.slotB);
    if (!hasPlayableMotionRoute(state.motionRoutes, cycleAvailable)) return;
    const run = createMotionRunSnapshot(
      state.motionPath,
      {
        bpm: state.motionBpm,
        beats: state.motionBeats,
        mode: state.motionMode,
      },
      state.motionRoutes,
      cycleAvailable,
    );
    synth.unlock();
    const nextRunId = state.motionRunId + 1;
    applyMotionSource(
      sampleMotionPath(run.path, 0),
      run.routes,
      run.cycleAvailable,
      true,
      {
        motionPlaying: true,
        motionProgress: 0,
        motionRunId: nextRunId,
        motionRun: run,
      },
    );
  },

  stopMotion: () => set({ motionPlaying: false }),

  setMotionBpm: (bpm) => {
    if (!get().motionPlaying) set({ motionBpm: clampMotionBpm(bpm) });
  },
  setMotionBeats: (beats) => {
    if (!get().motionPlaying && MOTION_BEAT_LENGTHS.includes(beats)) {
      set({ motionBeats: beats });
    }
  },
  setMotionMode: (mode) => {
    if (!get().motionPlaying) set({ motionMode: mode });
  },

  setMotionRouteEnabled: (route, enabled) => {
    const state = get();
    if (state.motionPlaying) return;
    switch (route) {
      case "cycle":
        set({
          motionRoutes: {
            ...state.motionRoutes,
            cycle: { ...state.motionRoutes.cycle, enabled },
          },
        });
        break;
      case "driveAmount":
        set({
          motionRoutes: {
            ...state.motionRoutes,
            driveAmount: { ...state.motionRoutes.driveAmount, enabled },
          },
        });
        break;
      case "chorusMix":
        set({
          motionRoutes: {
            ...state.motionRoutes,
            chorusMix: { ...state.motionRoutes.chorusMix, enabled },
          },
        });
        break;
      case "spaceMix":
        set({
          motionRoutes: {
            ...state.motionRoutes,
            spaceMix: { ...state.motionRoutes.spaceMix, enabled },
          },
        });
        break;
    }
  },

  setMotionRouteEndpoint: (route, endpoint, value) => {
    const state = get();
    if (state.motionPlaying) return;
    const next = clampMotionValue(value);
    switch (route) {
      case "driveAmount":
        set({
          motionRoutes: {
            ...state.motionRoutes,
            driveAmount: {
              ...state.motionRoutes.driveAmount,
              [endpoint]: next,
            },
          },
        });
        break;
      case "chorusMix":
        set({
          motionRoutes: {
            ...state.motionRoutes,
            chorusMix: {
              ...state.motionRoutes.chorusMix,
              [endpoint]: next,
            },
          },
        });
        break;
      case "spaceMix":
        set({
          motionRoutes: {
            ...state.motionRoutes,
            spaceMix: {
              ...state.motionRoutes.spaceMix,
              [endpoint]: next,
            },
          },
        });
        break;
    }
  },

  setMotionPlaybackPosition: (t, progress, complete, runId) => {
    const state = get();
    if (
      !state.motionPlaying ||
      state.motionRunId !== runId ||
      !state.motionRun
    ) {
      return;
    }
    applyMotionSource(
      t,
      state.motionRun.routes,
      state.motionRun.cycleAvailable,
      complete,
      {
        motionProgress: clampMotionValue(progress),
        ...(complete ? { motionPlaying: false } : {}),
      },
    );
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
    const { spaceSeed, spacePreset, spaceMetal, spacePast, spaceSeconds } = get();
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
    const state = get();
    const next = Math.min(1, Math.max(0, mix));
    set({
      spaceMix: next,
      ...(motionRouteIsWriting(state, "spaceMix")
        ? { motionPlaying: false }
        : {}),
    });
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
    if (get().domain === "drive") {
      const {
        drivePast,
        driveCurve,
        drivePreset,
        driveFuture,
        driveAmount,
        driveSafe,
      } = get();
      const prev = drivePast[drivePast.length - 1];
      if (!prev) return;
      set({
        driveCurve: cloneTransfer(prev.curve),
        drivePreset: prev.preset,
        drivePast: drivePast.slice(0, -1),
        driveFuture: [
          ...driveFuture,
          { curve: cloneTransfer(driveCurve), preset: drivePreset },
        ],
      });
      applyDrive(prev.curve, driveAmount, driveSafe);
      return;
    }
    if (get().domain === "chorus") {
      const { chorusPast, chorusCurve, chorusPreset, chorusFuture } = get();
      const prev = chorusPast[chorusPast.length - 1];
      if (!prev) return;
      set({
        chorusCurve: cloneChorusCurve(prev.curve),
        chorusPreset: prev.preset,
        chorusPast: chorusPast.slice(0, -1),
        chorusFuture: [
          ...chorusFuture,
          { curve: cloneChorusCurve(chorusCurve), preset: chorusPreset },
        ],
      });
      synth.setChorusCurve(prev.curve);
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
    const state = get();
    const { past, samples, future } = state;
    const prev = past[past.length - 1];
    if (!prev) return;
    set({
      samples: cloneWave(prev),
      preset: "custom",
      morphLive: false,
      ...(motionRouteIsWriting(state, "cycle")
        ? { motionPlaying: false }
        : {}),
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
    if (get().domain === "drive") {
      const {
        driveFuture,
        driveCurve,
        drivePreset,
        drivePast,
        driveAmount,
        driveSafe,
      } = get();
      const next = driveFuture[driveFuture.length - 1];
      if (!next) return;
      set({
        driveCurve: cloneTransfer(next.curve),
        drivePreset: next.preset,
        driveFuture: driveFuture.slice(0, -1),
        drivePast: pushDrivePast(drivePast, {
          curve: driveCurve,
          preset: drivePreset,
        }),
      });
      applyDrive(next.curve, driveAmount, driveSafe);
      return;
    }
    if (get().domain === "chorus") {
      const { chorusFuture, chorusCurve, chorusPreset, chorusPast } = get();
      const next = chorusFuture[chorusFuture.length - 1];
      if (!next) return;
      set({
        chorusCurve: cloneChorusCurve(next.curve),
        chorusPreset: next.preset,
        chorusFuture: chorusFuture.slice(0, -1),
        chorusPast: pushChorusPast(chorusPast, {
          curve: chorusCurve,
          preset: chorusPreset,
        }),
      });
      synth.setChorusCurve(next.curve);
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
    const state = get();
    const { future, samples, past } = state;
    const next = future[future.length - 1];
    if (!next) return;
    set({
      samples: cloneWave(next),
      preset: "custom",
      morphLive: false,
      ...(motionRouteIsWriting(state, "cycle")
        ? { motionPlaying: false }
        : {}),
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
synth.setDriveState(
  cloneTransfer(initialDriveCurve),
  DRIVE_DEFAULT_AMOUNT,
  DRIVE_DEFAULT_SAFE,
);
synth.setChorusCurve(cloneChorusCurve(initialChorusCurve));
synth.setChorusPeriod(CHORUS_DEFAULT_PERIOD);
synth.setChorusMix(0);
synth.setSpace(cloneContour(initialContour), initialSeed, false, SPACE_DEFAULT_SECONDS);
synth.setSpaceMix(INITIAL_SPACE_MIX);
