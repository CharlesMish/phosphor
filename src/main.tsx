import React from "react";
import ReactDOM from "react-dom/client";
import { PhosphorApp } from "@/components/synth/phosphor-app";
import { TreatmentProvider } from "@/lib/presentation/treatment";
import { soundSession } from "@/lib/synth/sound-session";
import "@/styles.css";
import "@/control-cabinet.css";

// Reopen the last sound before the first paint so the drawings never flash.
soundSession.restore();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TreatmentProvider>
      <PhosphorApp />
    </TreatmentProvider>
  </React.StrictMode>,
);
