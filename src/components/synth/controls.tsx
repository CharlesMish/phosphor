import {
  Dices,
  FlipHorizontal2,
  FlipVertical2,
  Maximize2,
  Minus,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Shuffle,
  Spline,
  Square,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { TreatmentSelector } from "./treatment-selector";
import {
  useSynthStore,
  type DrivePreset,
  type SpacePreset,
  type WavePreset,
} from "@/lib/synth/store";
import { PRESET_LABEL, PRESET_ORDER, generatePreset } from "@/lib/synth/waveform";
import {
  SPACE_PRESET_LABEL,
  SPACE_PRESET_ORDER,
  generateSpaceContour,
  contourToPath,
} from "@/lib/synth/space";
import {
  DRIVE_PRESET_LABEL,
  DRIVE_PRESET_ORDER,
  generateDrivePreset,
  transferToPath,
} from "@/lib/synth/drive";
import {
  CHORUS_PRESET_LABEL,
  CHORUS_PRESET_ORDER,
  type ChorusPreset,
} from "@/lib/synth/chorus";
import { rangeLabel } from "@/lib/synth/keyboard-map";
import {
  hasPlayableMotionRoute,
  MOTION_BEAT_LENGTHS,
  MOTION_BPM_MAX,
  MOTION_BPM_MIN,
  MOTION_MODES,
  type MotionBeats,
  type MotionMode,
} from "@/lib/synth/motion";
import { cn } from "@/lib/utils";
import { MotionRoutes } from "./motion-routes";

function MiniWave({ kind, active }: { kind: WavePreset; active: boolean }) {
  const w = 44;
  const h = 16;
  if (kind === "wild") {
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
        <path
          d="M0 8 L5 3 L10 14 L16 2 L22 12 L28 4 L34 13 L39 6 L44 9"
          fill="none"
          stroke="currentColor"
          strokeWidth={active ? 1.6 : 1.2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  const samples = generatePreset(kind);
  const d = samples
    .filter((_, i) => i % 8 === 0)
    .map((v, i, arr) => {
      const x = (i / Math.max(1, arr.length - 1)) * w;
      const y = (0.5 - v * 0.42) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 1.6 : 1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MiniContour({ kind, active }: { kind: SpacePreset; active: boolean }) {
  const w = 44;
  const h = 16;
  const d = contourToPath(generateSpaceContour(kind), w, h, 12);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 1.6 : 1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MiniTransfer({ kind, active }: { kind: DrivePreset; active: boolean }) {
  const w = 44;
  const h = 16;
  const d = transferToPath(generateDrivePreset(kind), w, h, 8);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 1.6 : 1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Param({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
        <span>{label}</span>
        <span className="tabular-nums text-muted">{display}</span>
      </span>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onChange(v[0] ?? value)}
        aria-label={label}
      />
    </label>
  );
}

export function SideParams() {
  const attack = useSynthStore((s) => s.attack);
  const release = useSynthStore((s) => s.release);
  const cutoff = useSynthStore((s) => s.cutoff);
  const setParam = useSynthStore((s) => s.setParam);

  return (
    <div className="grid grid-cols-3 gap-2 rounded-lg bg-surface p-3 shadow-border lg:flex lg:flex-col lg:gap-3">
      <Param
        label="Attack"
        value={attack}
        display={`${Math.round(attack * 1000)} ms`}
        min={0.004}
        max={0.8}
        step={0.004}
        onChange={(v) => setParam("attack", v)}
      />
      <Param
        label="Release"
        value={release}
        display={`${release.toFixed(2)} s`}
        min={0.03}
        max={2.2}
        step={0.01}
        onChange={(v) => setParam("release", v)}
      />
      <Param
        label="Low-pass"
        value={cutoff}
        display={cutoff > 0.97 ? "open" : `${Math.round(180 * Math.pow(100, cutoff))} Hz`}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => setParam("cutoff", v)}
      />
    </div>
  );
}

export function PresetBar() {
  const domain = useSynthStore((s) => s.domain);
  const preset = useSynthStore((s) => s.preset);
  const drivePreset = useSynthStore((s) => s.drivePreset);
  const chorusPreset = useSynthStore((s) => s.chorusPreset);
  const spacePreset = useSynthStore((s) => s.spacePreset);
  const applyPreset = useSynthStore((s) => s.applyPreset);
  const applyDrivePreset = useSynthStore((s) => s.applyDrivePreset);
  const applyChorusPreset = useSynthStore((s) => s.applyChorusPreset);
  const applySpacePreset = useSynthStore((s) => s.applySpacePreset);
  const scatterSpace = useSynthStore((s) => s.scatterSpace);
  const resetWave = useSynthStore((s) => s.resetWave);
  const smooth = useSynthStore((s) => s.smooth);
  const normalize = useSynthStore((s) => s.normalize);
  const invert = useSynthStore((s) => s.invert);
  const randomize = useSynthStore((s) => s.randomize);
  const mirror = useSynthStore((s) => s.mirror);
  const undo = useSynthStore((s) => s.undo);
  const redo = useSynthStore((s) => s.redo);
  const motionPlaying = useSynthStore((s) => s.motionPlaying);
  const motionCanPlay = useSynthStore((s) =>
    hasPlayableMotionRoute(s.motionRoutes, Boolean(s.slotA && s.slotB)),
  );
  const playMotion = useSynthStore((s) => s.playMotion);
  const stopMotion = useSynthStore((s) => s.stopMotion);
  const motionBpm = useSynthStore((s) => s.motionBpm);
  const motionBeats = useSynthStore((s) => s.motionBeats);
  const motionMode = useSynthStore((s) => s.motionMode);
  const setMotionBpm = useSynthStore((s) => s.setMotionBpm);
  const setMotionBeats = useSynthStore((s) => s.setMotionBeats);
  const setMotionMode = useSynthStore((s) => s.setMotionMode);
  const canUndo = useSynthStore((s) =>
    s.domain === "space"
      ? s.spacePast.length > 0
      : s.domain === "motion"
        ? s.motionPast.length > 0
        : s.domain === "drive"
          ? s.drivePast.length > 0
          : s.domain === "chorus"
            ? s.chorusPast.length > 0
            : s.past.length > 0,
  );
  const canRedo = useSynthStore((s) =>
    s.domain === "space"
      ? s.spaceFuture.length > 0
      : s.domain === "motion"
        ? s.motionFuture.length > 0
        : s.domain === "drive"
          ? s.driveFuture.length > 0
          : s.domain === "chorus"
            ? s.chorusFuture.length > 0
            : s.future.length > 0,
  );

  const cycleActions = [
    { id: "undo", label: "Undo", icon: Undo2, run: undo, disabled: !canUndo },
    { id: "redo", label: "Redo", icon: Redo2, run: redo, disabled: !canRedo },
    { id: "reset", label: "Reset", icon: RotateCcw, run: resetWave, disabled: false },
    { id: "smooth", label: "Smooth", icon: Spline, run: smooth, disabled: false },
    { id: "norm", label: "Norm", icon: Maximize2, run: normalize, disabled: false },
    { id: "invert", label: "Invert", icon: FlipVertical2, run: invert, disabled: false },
    { id: "mirror", label: "Mirror", icon: FlipHorizontal2, run: mirror, disabled: false },
    { id: "wild", label: "Random", icon: Shuffle, run: randomize, disabled: false },
  ] as const;

  const spaceActions = [
    { id: "undo", label: "Undo", icon: Undo2, run: undo, disabled: !canUndo },
    { id: "redo", label: "Redo", icon: Redo2, run: redo, disabled: !canRedo },
    { id: "scatter", label: "Scatter", icon: Dices, run: scatterSpace, disabled: false },
  ] as const;

  const fxActions = [
    { id: "undo", label: "Undo", icon: Undo2, run: undo, disabled: !canUndo },
    { id: "redo", label: "Redo", icon: Redo2, run: redo, disabled: !canRedo },
  ] as const;

  if (domain === "motion") {
    return (
      <div className="flex flex-col gap-2">
        <MotionRoutes />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              <span>BPM</span>
              <input
                type="number"
                min={MOTION_BPM_MIN}
                max={MOTION_BPM_MAX}
                step={1}
                value={motionBpm}
                disabled={motionPlaying}
                onChange={(event) => {
                  const next = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(next)) setMotionBpm(next);
                }}
                className="h-9 w-16 rounded-md bg-surface-2 px-2 text-center text-xs tabular-nums text-fg shadow-border outline-none focus-visible:ring-2 focus-visible:ring-focus/50 disabled:opacity-50"
                aria-label="Motion BPM"
              />
            </label>
            <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              <span>Length</span>
              <select
                value={motionBeats}
                disabled={motionPlaying}
                onChange={(event) =>
                  setMotionBeats(Number(event.currentTarget.value) as MotionBeats)
                }
                className="h-9 rounded-md bg-surface-2 px-2 text-xs text-fg shadow-border outline-none focus-visible:ring-2 focus-visible:ring-focus/50 disabled:opacity-50"
                aria-label="Motion length"
              >
                {MOTION_BEAT_LENGTHS.map((beats) => (
                  <option key={beats} value={beats}>
                    {beats} {beats === 1 ? "beat" : "beats"}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              <span>Mode</span>
              <select
                value={motionMode}
                disabled={motionPlaying}
                onChange={(event) =>
                  setMotionMode(event.currentTarget.value as MotionMode)
                }
                className="h-9 rounded-md bg-surface-2 px-2 text-xs text-fg shadow-border outline-none focus-visible:ring-2 focus-visible:ring-focus/50 disabled:opacity-50"
                aria-label="Motion mode"
              >
                {MOTION_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode === "one-shot"
                      ? "One-shot"
                      : mode === "ping-pong"
                        ? "Ping-pong"
                        : "Loop"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant={motionPlaying ? "solid" : "outline"}
              size="sm"
              onClick={playMotion}
              disabled={!motionCanPlay}
              className="h-9 px-3"
              aria-label={motionPlaying ? "Retrigger Motion" : "Play Motion"}
            >
              <Play className="size-3.5" aria-hidden />
              {motionPlaying ? "Retrigger" : "Play"}
            </Button>
            <Button
              variant="subtle"
              size="sm"
              onClick={stopMotion}
              disabled={!motionPlaying}
              className="h-9 px-3"
            >
              <Square className="size-3.5" aria-hidden />
              Stop
            </Button>
            <Button
              variant="subtle"
              size="sm"
              onClick={undo}
              disabled={!canUndo}
              className="h-9 px-2"
            >
              <Undo2 className="size-3.5" aria-hidden />
              Undo
            </Button>
            <Button
              variant="subtle"
              size="sm"
              onClick={redo}
              disabled={!canRedo}
              className="h-9 px-2"
            >
              <Redo2 className="size-3.5" aria-hidden />
              Redo
            </Button>
          </div>
        </div>
        {!motionCanPlay && (
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            Enable a Motion destination
          </p>
        )}
      </div>
    );
  }

  if (domain === "drive") {
    return (
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {DRIVE_PRESET_ORDER.map((kind) => {
            const on = drivePreset === kind;
            return (
              <Button
                key={kind}
                variant={on ? "solid" : "outline"}
                size="sm"
                className={cn("h-10 min-w-16 flex-col gap-0 px-2 py-1", on && "text-active-ink")}
                onClick={() => applyDrivePreset(kind)}
                aria-pressed={on}
              >
                <MiniTransfer kind={kind} active={on} />
                <span className="font-mono text-[10px] uppercase tracking-wider">
                  {DRIVE_PRESET_LABEL[kind]}
                </span>
              </Button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {fxActions.map((action) => (
            <Button
              key={action.id}
              variant="subtle"
              size="sm"
              onClick={action.run}
              disabled={action.disabled}
              className="h-8 px-2 sm:h-9"
            >
              <action.icon className="size-3.5" aria-hidden />
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  if (domain === "chorus") {
    return (
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {CHORUS_PRESET_ORDER.map((kind: ChorusPreset) => {
            const on = chorusPreset === kind;
            return (
              <Button
                key={kind}
                variant={on ? "solid" : "outline"}
                size="sm"
                className={cn(
                  "h-10 min-w-14 px-2 font-mono text-[10px] uppercase tracking-wider",
                  on && "text-active-ink",
                )}
                onClick={() => applyChorusPreset(kind)}
                aria-pressed={on}
              >
                <span className="mr-1 text-base leading-none">
                  {kind === "sine" ? "∿" : kind === "triangle" ? "⌁" : kind === "rise" ? "↗" : "⌇"}
                </span>
                {CHORUS_PRESET_LABEL[kind]}
              </Button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {fxActions.map((action) => (
            <Button
              key={action.id}
              variant="subtle"
              size="sm"
              onClick={action.run}
              disabled={action.disabled}
              className="h-8 px-2 sm:h-9"
            >
              <action.icon className="size-3.5" aria-hidden />
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  if (domain === "space") {
    return (
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {SPACE_PRESET_ORDER.map((kind) => {
            const on = spacePreset === kind;
            return (
              <Button
                key={kind}
                variant={on ? "solid" : "outline"}
                size="sm"
                className={cn("h-10 min-w-14 flex-col gap-0 px-2 py-1", on && "text-active-ink")}
                onClick={() => applySpacePreset(kind)}
                aria-pressed={on}
              >
                <MiniContour kind={kind} active={on} />
                <span className="font-mono text-[10px] uppercase tracking-wider">
                  {SPACE_PRESET_LABEL[kind]}
                </span>
              </Button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {spaceActions.map((a) => (
            <Button
              key={a.id}
              variant="subtle"
              size="sm"
              onClick={a.run}
              disabled={a.disabled}
              className="h-8 px-2 sm:h-9"
            >
              <a.icon className="size-3.5" aria-hidden />
              {a.label}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap gap-1.5">
        {PRESET_ORDER.map((kind) => {
          const on = preset === kind;
          return (
            <Button
              key={kind}
              variant={on ? "solid" : "outline"}
              size="sm"
              className={cn("h-10 min-w-14 flex-col gap-0 px-2 py-1", on && "text-active-ink")}
              onClick={() => applyPreset(kind)}
              aria-pressed={on}
            >
              <MiniWave kind={kind} active={on} />
              <span className="font-mono text-[10px] uppercase tracking-wider">
                {PRESET_LABEL[kind]}
              </span>
            </Button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {cycleActions.map((a) => (
          <Button
            key={a.id}
            variant="subtle"
            size="sm"
            onClick={a.run}
            disabled={a.disabled}
            className="h-8 px-2 sm:h-9"
          >
            <a.icon className="size-3.5" aria-hidden />
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function HeaderBar() {
  const domain = useSynthStore((s) => s.domain);
  const octave = useSynthStore((s) => s.octave);
  const setOctave = useSynthStore((s) => s.setOctave);
  const volume = useSynthStore((s) => s.volume);
  const setParam = useSynthStore((s) => s.setParam);
  const audioReady = useSynthStore((s) => s.audioReady);
  const active = useSynthStore((s) => s.activeNotes.length);

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-baseline gap-3">
          <h1 className="phosphor-wordmark text-xl text-fg">Phosphor</h1>
          <p className="hidden font-mono text-[11px] uppercase tracking-[0.2em] text-faint sm:block">
            {domain === "space"
              ? "Draw the space"
              : domain === "motion"
                ? "Draw the motion"
                : domain === "drive"
                  ? "Draw the drive"
                  : domain === "chorus"
                    ? "Draw the chorus"
                    : "Draw the cycle"}
          </p>
        </div>
        <TreatmentSelector />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-2 rounded-full",
              audioReady ? "bg-status" : "bg-faint",
            )}
            title={audioReady ? "Audio armed" : "Tap a key to arm audio"}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
            {audioReady ? (active > 0 ? "live" : "armed") : "standby"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="subtle"
            size="icon"
            className="size-9"
            aria-label="Octave down"
            onClick={() => setOctave(octave - 1)}
            disabled={octave <= -2}
          >
            <Minus className="size-4" />
          </Button>
          <div className="min-w-20 text-center font-mono text-xs tabular-nums text-muted">
            {rangeLabel(octave)}
          </div>
          <Button
            variant="subtle"
            size="icon"
            className="size-9"
            aria-label="Octave up"
            onClick={() => setOctave(octave + 1)}
            disabled={octave >= 3}
          >
            <Plus className="size-4" />
          </Button>
        </div>
        <label className="flex w-36 items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Vol</span>
          <Slider
            min={0}
            max={1}
            step={0.01}
            value={[volume]}
            onValueChange={(v) => setParam("volume", v[0] ?? volume)}
            aria-label="Master volume"
          />
        </label>
      </div>
    </header>
  );
}
