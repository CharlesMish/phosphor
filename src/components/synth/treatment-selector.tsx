import { ChevronDown } from "lucide-react";
import {
  TREATMENT_OPTIONS,
  isTreatment,
  useTreatment,
} from "@/lib/presentation/treatment";

export function TreatmentSelector() {
  const { treatment, setTreatment } = useTreatment();

  return (
    <label
      className="relative block shrink-0"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="sr-only">Presentation treatment</span>
      <select
        value={treatment}
        onChange={(event) => {
          const nextTreatment = event.target.value;
          if (isTreatment(nextTreatment)) setTreatment(nextTreatment);
        }}
        className="h-9 w-36 appearance-none rounded-md bg-surface-2 pl-2.5 pr-7 font-mono text-[10px] uppercase tracking-[0.14em] text-muted shadow-border outline-none transition-[color,box-shadow,background-color] hover:text-fg hover:shadow-border-hover focus-visible:ring-2 focus-visible:ring-focus/50 sm:w-44"
        aria-label="Presentation treatment"
        data-testid="treatment-selector"
      >
        {TREATMENT_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-faint"
        aria-hidden
      />
    </label>
  );
}
