import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useSynthStore } from "@/lib/synth/store";
import { samplesToPath } from "@/lib/synth/waveform";
import { cn } from "@/lib/utils";

function WaveThumb({ samples }: { samples: number[] | null }) {
  const w = 52;
  const h = 18;
  if (!samples) {
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="text-faint">
        <path d={`M0 ${h / 2} H${w}`} fill="none" stroke="currentColor" strokeWidth={1} />
      </svg>
    );
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible text-trace">
      <path
        d={samplesToPath(samples, w, h)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Slot({
  label,
  samples,
  onCapture,
}: {
  label: string;
  samples: number[] | null;
  onCapture: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onCapture}
      className={cn(
        "h-11 min-w-[4.5rem] flex-col gap-0 px-2 py-1 sm:h-11",
        samples && "text-trace",
      )}
      aria-label={samples ? `Recapture slot ${label}` : `Capture current waveform as ${label}`}
    >
      <WaveThumb samples={samples} />
      <span className="font-mono text-xs uppercase tracking-wider">
        {samples ? label : `Set ${label}`}
      </span>
    </Button>
  );
}

export function MorphBar() {
  const slotA = useSynthStore((s) => s.slotA);
  const slotB = useSynthStore((s) => s.slotB);
  const morph = useSynthStore((s) => s.morph);
  const morphLive = useSynthStore((s) => s.morphLive);
  const captureA = useSynthStore((s) => s.captureA);
  const captureB = useSynthStore((s) => s.captureB);
  const swapSlots = useSynthStore((s) => s.swapSlots);
  const setMorph = useSynthStore((s) => s.setMorph);
  const armed = Boolean(slotA && slotB);
  const engaged = armed && morphLive;

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-surface px-2 py-1.5 shadow-border sm:gap-2 sm:py-2">
      <Slot label="A" samples={slotA} onCapture={captureA} />
      <div className="flex min-w-32 flex-1 basis-40 items-center gap-2">
        <span
          className={cn(
            "w-12 shrink-0 font-mono text-xs uppercase tracking-wider",
            engaged ? "text-active" : "text-faint",
          )}
        >
          {armed && !morphLive ? "Custom" : "Morph"}
        </span>
        <Slider
          min={0}
          max={1}
          step={0.002}
          value={[morph]}
          disabled={!armed}
          className={cn(armed && !morphLive && "opacity-50")}
          onValueChange={(v) => setMorph(v[0] ?? morph, false)}
          onValueCommit={(v) => setMorph(v[0] ?? morph, true)}
          aria-label={
            engaged
              ? "Morph A to B. Hold K on the keyboard, then drag."
              : armed
                ? "Morph A to B. Drag to return to the A/B blend."
                : "Morph A to B"
          }
          title={
            engaged
              ? "Hold K on the keyboard, then drag with the mouse"
              : armed
                ? "Drag to morph A into B"
                : "Capture A and B to morph"
          }
        />
        {engaged && (
          <span
            className="hidden shrink-0 font-mono text-xs uppercase tracking-wider text-faint sm:block"
            title="Hold K on the keyboard, then drag morph with the mouse"
          >
            Hold K
          </span>
        )}
      </div>
      <Slot label="B" samples={slotB} onCapture={captureB} />
      <Button
        variant="subtle"
        size="sm"
        className="h-9"
        onClick={swapSlots}
        disabled={!slotA && !slotB}
        aria-label="Swap A and B"
      >
        <ArrowLeftRight className="size-3.5" aria-hidden />
        <span className="font-mono text-xs uppercase tracking-wider">Swap</span>
      </Button>
    </div>
  );
}
