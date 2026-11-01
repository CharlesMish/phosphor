import React from "react";
import ReactDOM from "react-dom/client";
import { PhosphorApp } from "@/components/synth/phosphor-app";
import { TreatmentProvider } from "@/lib/presentation/treatment";
import { restoreLocalSession } from "@/lib/synth/session-apply";
import "@/styles.css";
import "@/control-cabinet.css";

restoreLocalSession();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TreatmentProvider>
      <PhosphorApp />
    </TreatmentProvider>
  </React.StrictMode>,
);
