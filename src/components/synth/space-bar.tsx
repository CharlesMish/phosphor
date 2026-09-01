import { Slider } from "@/components/ui/slider";
import { useSynthStore } from "@/lib/synth/store";
import {
  SPACE_MAX_SECONDS,
  SPACE_MIN_SECONDS,
  SPACE_SECONDS_STEP,
} from "@/lib/synth/space";

export function SpaceBar() {
  const mix = useSynthStore((s) => s.spaceMix);
  const seconds = useSynthStore((s) => s.spaceSeconds);
  const setSpaceMix = useSynthStore((s) => s.setSpaceMix);
  const setSpaceLength = useSynthStore((s) => s.setSpaceLength);
  const commitSpaceLength = useSynthStore((s) => s.commitSpaceLength);

  return (
    <div className="grid gap-x-3 rounded-lg bg-surface px-3 py-1.5 shadow-border sm:grid-cols-2 sm:py-2">
      <label className="flex min-w-0 items-center gap-3">
        <span className="w-12 shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-active">
          Mix
        </span>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[mix]}
          onValueChange={(v) => setSpaceMix(v[0] ?? mix)}
          aria-label="Space mix"
          className="min-w-0 flex-1"
        />
        <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted">
          {Math.round(mix * 100)}%
        </span>
      </label>
      <label className="flex min-w-0 items-center gap-3">
        <span className="w-12 shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-active">
          Length
        </span>
        <Slider
          min={SPACE_MIN_SECONDS}
          max={SPACE_MAX_SECONDS}
          step={SPACE_SECONDS_STEP}
          value={[seconds]}
          onValueChange={(v) => setSpaceLength(v[0] ?? seconds)}
          onValueCommit={(v) => commitSpaceLength(v[0] ?? seconds)}
          aria-label="Space length"
          className="min-w-0 flex-1"
        />
        <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted">
          {seconds.toFixed(1)} s
        </span>
      </label>
    </div>
  );
}
