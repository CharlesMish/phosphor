import React from "react";
import ReactDOM from "react-dom/client";
import { PhosphorApp } from "@/components/synth/phosphor-app";
import { TreatmentProvider } from "@/lib/presentation/treatment";
import { PanelProvider } from "@/lib/presentation/panel";
import "@/styles.css";
import "@/panel-lanes.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TreatmentProvider>
      <PanelProvider>
        <PhosphorApp />
      </PanelProvider>
    </TreatmentProvider>
  </React.StrictMode>,
);
