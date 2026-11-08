import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // Serve the dev lab under /phosphor/. Production assets resolve beside index.html.
  base: command === "build" ? "./" : "/phosphor/",
  // Allow the exact managed preview host in addition to Vite's localhost defaults.
  server: { allowedHosts: ["terminal.local"] },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [tailwindcss(), react()],
}));
