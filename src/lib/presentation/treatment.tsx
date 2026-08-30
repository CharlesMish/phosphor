import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export const TREATMENT_OPTIONS = [
  { id: "phosphor", label: "Phosphor" },
  { id: "registration-ink", label: "Registration Ink" },
  { id: "deep-observatory", label: "Deep Observatory" },
  { id: "ultraviolet-laboratory", label: "Ultraviolet Laboratory" },
] as const;

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
  const [treatment, setTreatment] = useState<Treatment>("phosphor");
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
