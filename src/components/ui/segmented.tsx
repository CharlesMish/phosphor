import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export type SegmentOption<T extends string> = { value: T; label: string; title?: string };

/**
 * A small radio group drawn as segments. One tab stop (the checked option);
 * arrow keys move and select, as the ARIA radio-group pattern expects.
 */
export function Segmented<T extends string>({ label, value, options, onChange, className }: {
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label}
      className={cn("flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5 shadow-border", className)}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            title={option.title}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              "h-8 rounded px-2 font-mono text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus/50",
              checked ? "bg-active-soft text-fg" : "text-muted hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
