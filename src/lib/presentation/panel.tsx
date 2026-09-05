import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export const PANEL_OPTIONS = [
  {
    id: "bench",
    number: "01",
    label: "Bench",
    short: "A compact instrument",
    description: "One framed surface for drawing and playing, with a quiet output rack on the right.",
  },
  {
    id: "desk",
    number: "02",
    label: "Signal Desk",
    short: "Room for the waveform",
    description: "A wide drawing field, with output and sound controls arranged in a slim band below.",
  },
  {
    id: "cabinet",
    number: "03",
    label: "Control Cabinet",
    short: "A technical control panel",
    description: "A left-hand control rack, precise divisions, and a large, square-edged plotting surface.",
  },
] as const;

export type Panel = (typeof PANEL_OPTIONS)[number]["id"];
type PanelContextValue = { panel: Panel; setPanel: (panel: Panel) => void };
const PanelContext = createContext<PanelContextValue | null>(null);

export function PanelProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<Panel>("bench");
  const value = useMemo(() => ({ panel, setPanel }), [panel]);
  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}

export function usePanel() {
  const value = useContext(PanelContext);
  if (!value) throw new Error("usePanel must be used within PanelProvider");
  return value;
}
