import { PANEL_OPTIONS, usePanel, type Panel } from "@/lib/presentation/panel";

function PanelDiagram({ panel }: { panel: Panel }) {
  const left = panel === "cabinet" ? 17 : 4;
  const width = panel === "desk" ? 44 : 31;
  return (
    <svg viewBox="0 0 52 38" width="52" height="38" fill="none" aria-hidden>
      <rect x="1" y="1" width="50" height="36" rx={panel === "cabinet" ? 0 : 4} stroke="currentColor" opacity=".35" />
      <rect x={left} y="5" width={width} height={panel === "desk" ? 15 : 21} rx={panel === "cabinet" ? 0 : 1.5} stroke="currentColor" opacity=".7" />
      <path d={panel === "desk" ? "M6 13 Q12 4 19 13 T32 13 T45 13" : panel === "cabinet" ? "M19 16 Q25 3 32 16 T46 16" : "M6 16 Q12 3 19 16 T33 16"} stroke="currentColor" strokeWidth="1.2" />
      {panel === "desk" ? (
        <path d="M4 24 H48 M18 22 V26 M34 22 V26" stroke="currentColor" opacity=".45" />
      ) : (
        <path d={panel === "cabinet" ? "M5 8 H12 M5 15 H12 M5 22 H12" : "M40 8 H47 M40 15 H47 M40 22 H47"} stroke="currentColor" opacity=".55" />
      )}
      <path d="M5 31 H47 M12 29 V34 M19 29 V34 M26 29 V34 M33 29 V34 M40 29 V34" stroke="currentColor" opacity=".6" />
    </svg>
  );
}

export function PanelSelector() {
  const { panel, setPanel } = usePanel();
  const selected = PANEL_OPTIONS.find((option) => option.id === panel)!;
  return (
    <section className="phosphor-lane-picker" aria-label="Compare panel layouts" onPointerDown={(event) => event.stopPropagation()}>
      <div className="phosphor-lane-heading">
        <span>Phosphor / panel study</span>
        <span className="phosphor-lane-note">Three layouts · four treatments</span>
      </div>
      <div className="phosphor-lane-options" role="group" aria-label="Panel layout">
        {PANEL_OPTIONS.map((option) => (
          <button key={option.id} type="button" onClick={() => setPanel(option.id)} aria-pressed={panel === option.id} className="phosphor-lane-option">
            <PanelDiagram panel={option.id} />
            <span className="phosphor-lane-name"><span className="phosphor-lane-number">{option.number}</span>{option.label}<small>{option.short}</small></span>
          </button>
        ))}
      </div>
      <p className="phosphor-lane-description" aria-live="polite">{selected.description}</p>
    </section>
  );
}
