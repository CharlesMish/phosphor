import { Slider } from "@/components/ui/slider";
import { useSynthStore } from "@/lib/synth/store";

export function ChorusBar() {
  const period = useSynthStore((s) => s.chorusPeriod);
  const mix = useSynthStore((s) => s.chorusMix);
  const setPeriod = useSynthStore((s) => s.setChorusPeriod);
  const setMix = useSynthStore((s) => s.setChorusMix);

  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface px-3 py-2 shadow-border">
      <label className="min-w-0">
        <span className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
          <span>Period</span><span className="text-muted">{period.toFixed(2)} s</span>
        </span>
        <Slider min={0.25} max={4} step={0.01} value={[period]} onValueChange={(v) => setPeriod(v[0] ?? period)} aria-label="Chorus period" />
      </label>
      <label className="min-w-0">
        <span className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
          <span>Mix</span><span className="text-muted">{Math.round(mix * 100)}%</span>
        </span>
        <Slider min={0} max={1} step={0.01} value={[mix]} onValueChange={(v) => setMix(v[0] ?? mix)} aria-label="Chorus mix" />
      </label>
    </div>
  );
}
