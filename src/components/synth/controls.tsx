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
import { useSynthStore, type WavePreset, type SpacePreset } from "@/lib/synth/store";
import { PRESET_LABEL, PRESET_ORDER, generatePreset } from "@/lib/synth/waveform";
import {
  SPACE_PRESET_LABEL,
  SPACE_PRESET_ORDER,
  generateSpaceContour,
  contourToPath,
} from "@/lib/synth/space";
import { rangeLabel } from "@/lib/synth/keyboard-map";
import { MOTION_SECONDS } from "@/lib/synth/motion";
import { cn } from "@/lib/utils";

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
  const spacePreset = useSynthStore((s) => s.spacePreset);
  const applyPreset = useSynthStore((s) => s.applyPreset);
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
  const motionArmed = useSynthStore((s) => Boolean(s.slotA && s.slotB));
  const playMotion = useSynthStore((s) => s.playMotion);
  const stopMotion = useSynthStore((s) => s.stopMotion);
  const canUndo = useSynthStore((s) =>
    s.domain === "space"
      ? s.spacePast.length > 0
      : s.domain === "motion"
        ? s.motionPast.length > 0
        : s.past.length > 0,
  );
  const canRedo = useSynthStore((s) =>
    s.domain === "space"
      ? s.spaceFuture.length > 0
      : s.domain === "motion"
        ? s.motionFuture.length > 0
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

  if (domain === "motion") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
          {MOTION_SECONDS.toFixed(0)} s · one shot
        </span>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant={motionPlaying ? "solid" : "outline"}
            size="sm"
            onClick={playMotion}
            disabled={!motionArmed}
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
