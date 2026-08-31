import { useSynthStore, type EditorDomain } from "@/lib/synth/store";
import { cn } from "@/lib/utils";

const EDITORS: Array<{ domain: EditorDomain; label: string }> = [
  { domain: "cycle", label: "Cycle" },
  { domain: "motion", label: "Motion" },
  { domain: "space", label: "Space" },
];

export function EditorTabs() {
  const domain = useSynthStore((s) => s.domain);
  const setDomain = useSynthStore((s) => s.setDomain);

  return (
    <div
      className="pointer-events-auto flex rounded-md bg-surface-2 p-0.5 shadow-border"
      aria-label="Drawing editor"
      role="group"
    >
      {EDITORS.map((editor) => {
        const active = domain === editor.domain;
        return (
          <button
            key={editor.domain}
            type="button"
            className={cn(
              "h-7 rounded px-2 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors",
              active ? "bg-active text-active-ink" : "text-faint hover:text-fg",
            )}
            aria-pressed={active}
            onClick={() => setDomain(editor.domain)}
          >
            {editor.label}
          </button>
        );
      })}
    </div>
  );
}
