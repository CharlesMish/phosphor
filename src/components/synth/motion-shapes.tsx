import { MOTION_PRESETS, generateMotionPreset, motionPathsDiffer } from "@/lib/synth/motion";
import { useSynthStore } from "@/lib/synth/store";
import { Button } from "@/components/ui/button";

const shapes = MOTION_PRESETS.map((preset) => {
  const path = generateMotionPreset(preset.id);
  const preview = Array.from({ length: 33 }, (_, i) => {
    const value = path[Math.round(i * (path.length - 1) / 32)]!;
    return `${i === 0 ? "M" : "L"}${2 + i},${20 - value * 18}`;
  }).join(" ");
  return { ...preset, path, preview };
});

export function MotionShapes() {
  const path = useSynthStore((s) => s.motionPath);
  const apply = useSynthStore((s) => s.applyMotionPreset);
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Motion shapes">
      <span className="mr-1 font-mono text-xs uppercase tracking-wider text-faint">Shape</span>
      {shapes.map((shape) => {
        const selected = !motionPathsDiffer(path, shape.path);
        return (
          <Button key={shape.id} type="button" size="sm" variant={selected ? "solid" : "outline"}
            className="h-10 gap-2 px-3" aria-pressed={selected} title={shape.description}
            onClick={() => apply(shape.id)}>
            <svg viewBox="0 0 36 22" width="36" height="22" fill="none" aria-hidden="true">
              <path d={shape.preview} stroke="currentColor" strokeWidth="1.5" />
            </svg>
            {shape.label}
          </Button>
        );
      })}
    </div>
  );
}
