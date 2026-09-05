import { Slider } from "@/components/ui/slider";
import { effectiveDriveAmount } from "@/lib/synth/drive";
import { useSynthStore } from "@/lib/synth/store";

export function DriveBar() {
  const amount = useSynthStore((s) => s.driveAmount);
  const safe = useSynthStore((s) => s.driveSafe);
  const setAmount = useSynthStore((s) => s.setDriveAmount);
  const setSafe = useSynthStore((s) => s.setDriveSafe);
  const appliedAmount = effectiveDriveAmount(amount, safe);
  const percent = Math.round(appliedAmount * 100);

  return (
    <div className="grid gap-x-3 rounded-lg bg-surface px-3 py-1.5 shadow-border sm:grid-cols-2 sm:py-2">
      <label className="flex min-h-11 min-w-0 items-center gap-2">
        <input
          type="checkbox"
          checked={safe}
          onChange={(event) => setSafe(event.currentTarget.checked)}
          className="size-4 shrink-0 accent-active outline-none focus-visible:ring-2 focus-visible:ring-focus/50"
        />
        <span
          className={`font-mono text-xs uppercase tracking-wider ${safe ? "text-active" : "text-faint"}`}
        >
          Safe
        </span>
        <span className="min-w-0 font-mono text-xs uppercase tracking-wider text-muted">
          {safe ? "on · max 25%" : "off"}
        </span>
      </label>
      <label className="flex min-h-11 min-w-0 items-center gap-3">
        <span className="w-14 shrink-0 font-mono text-xs uppercase tracking-wider text-active">
          Amount
        </span>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[amount]}
          onValueChange={(value) => setAmount(value[0] ?? amount)}
          aria-label="Drive amount"
          aria-valuetext={`${percent}% applied, Safe ${safe ? "on" : "off"}; Safe range is 0 to 25%`}
          className="min-w-0 flex-1"
          trackDecoration={
            <>
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1/4 bg-active-soft"
              />
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-1/4 z-20 w-px bg-fg/70"
              />
            </>
          }
        />
        <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted">
          {percent}%
        </span>
      </label>
    </div>
  );
}
