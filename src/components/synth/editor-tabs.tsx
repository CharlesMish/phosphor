import { useSynthStore, type EditorDomain } from "@/lib/synth/store";
import { cn } from "@/lib/utils";

const EDITORS: Array<{ domain: EditorDomain; label: string }> = [
  { domain: "cycle", label: "Cycle" },
  { domain: "motion", label: "Motion" },
  { domain: "drive", label: "Drive" },
  { domain: "chorus", label: "Chorus" },
  { domain: "space", label: "Space" },
];

export function EditorTabs() {
  const domain = useSynthStore((s) => s.domain);
  const setDomain = useSynthStore((s) => s.setDomain);

  return (
    <div
      className="flex min-w-0 flex-wrap gap-0.5 rounded-md bg-surface-2 p-0.5 shadow-border"
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
              "min-h-9 flex-1 rounded px-2 font-mono text-xs uppercase tracking-wider outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus",
              active ? "bg-active text-active-ink" : "text-muted hover:text-fg",
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
