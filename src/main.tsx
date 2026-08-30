import React from "react";
import ReactDOM from "react-dom/client";
import { PhosphorApp } from "@/components/synth/phosphor-app";
import { TreatmentProvider } from "@/lib/presentation/treatment";
import "@/styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TreatmentProvider>
      <PhosphorApp />
    </TreatmentProvider>
  </React.StrictMode>,
);
