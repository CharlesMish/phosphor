import { effectiveDriveAmount } from "@/lib/synth/drive";
import { useSynthStore, type EditorDomain } from "@/lib/synth/store";

/** Persistent settings overview; selecting an editor never toggles an effect. */
export function EffectsSummary() {
  const domain = useSynthStore((s) => s.domain);
  const setDomain = useSynthStore((s) => s.setDomain);
  const amount = useSynthStore((s) => s.driveAmount);
  const safe = useSynthStore((s) => s.driveSafe);
  const drivePreset = useSynthStore((s) => s.drivePreset);
  const chorusMix = useSynthStore((s) => s.chorusMix);
  const spaceMix = useSynthStore((s) => s.spaceMix);
  const drivePercent = Math.round(effectiveDriveAmount(amount, safe) * 100);
  const rows: Array<{ domain: EditorDomain; label: string; value: string }> = [
    {
      domain: "drive",
      label: "Drive",
      value: drivePreset === "identity"
        ? "Identity"
        : drivePercent === 0 ? "Bypass" : `${drivePercent}%${safe ? " · Safe" : ""}`,
    },
    { domain: "chorus", label: "Chorus", value: chorusMix === 0 ? "Bypass" : `${Math.round(chorusMix * 100)}% mix` },
    { domain: "space", label: "Space", value: spaceMix === 0 ? "Bypass" : `${Math.round(spaceMix * 100)}% mix` },
  ];

  return (
    <section className="phosphor-effects rounded-lg bg-surface p-3 shadow-border" aria-label="Effect settings">
      <h2 className="mb-2 font-mono text-xs uppercase tracking-wider text-muted">Effects</h2>
      <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
        {rows.map((row) => (
          <button
            key={row.domain}
            type="button"
            aria-label={`Edit ${row.label}: ${row.value}`}
            aria-pressed={domain === row.domain}
            onClick={() => setDomain(row.domain)}
            className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md bg-surface-2 px-2.5 py-2 text-left font-mono text-xs text-muted outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-focus aria-pressed:bg-active-soft aria-pressed:text-active"
          >
            <span>{row.label}</span>
            <span className="tabular-nums">{row.value}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
