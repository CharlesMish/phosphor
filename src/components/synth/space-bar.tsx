import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useSynthStore } from "@/lib/synth/store";

export function SpaceBar() {
  const mix = useSynthStore((s) => s.spaceMix);
  const setSpaceMix = useSynthStore((s) => s.setSpaceMix);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface px-3 py-1.5 shadow-border sm:py-2">
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
    </div>
  );
}
