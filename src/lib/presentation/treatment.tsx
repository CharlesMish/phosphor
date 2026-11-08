import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Ultraviolet Laboratory is Figurestead's reference dark theme and the only
 * treatment kept from the original set. A light treatment (Figurestead's
 * Lavender Fog Notebook) can be added here later; the selector appears again
 * once there is more than one option.
 */
export const TREATMENT_OPTIONS = [
  { id: "ultraviolet-laboratory", label: "Ultraviolet Laboratory" },
] as const;

export const DEFAULT_TREATMENT: Treatment = "ultraviolet-laboratory";

export type Treatment = (typeof TREATMENT_OPTIONS)[number]["id"];

type TreatmentContextValue = {
  treatment: Treatment;
  setTreatment: (treatment: Treatment) => void;
};

const TreatmentContext = createContext<TreatmentContextValue | null>(null);

export function isTreatment(value: string): value is Treatment {
  return TREATMENT_OPTIONS.some((option) => option.id === value);
}

export function TreatmentProvider({ children }: { children: ReactNode }) {
  const [treatment, setTreatment] = useState<Treatment>(DEFAULT_TREATMENT);
  const value = useMemo(() => ({ treatment, setTreatment }), [treatment]);

  return (
    <TreatmentContext.Provider value={value}>{children}</TreatmentContext.Provider>
  );
}

export function useTreatment() {
  const value = useContext(TreatmentContext);
  if (!value) throw new Error("useTreatment must be used within TreatmentProvider");
  return value;
}
