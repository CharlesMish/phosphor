import { useEffect, useRef } from "react";
import {
  readCanvasTreatmentTokens,
  type CanvasTreatmentTokens,
} from "@/lib/presentation/canvas-tokens";
import { useTreatment } from "@/lib/presentation/treatment";
import { synth } from "@/lib/synth/engine";
import { useSynthStore } from "@/lib/synth/store";
import { findRisingZero } from "@/lib/synth/trigger";

function drawScopeGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  tokens: CanvasTreatmentTokens,
) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = tokens.gridMinor;
  ctx.beginPath();
  for (let g = 1; g < 4; g++) {
    const x = (g / 4) * width;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  ctx.moveTo(0, height * 0.25);
  ctx.lineTo(width, height * 0.25);
  ctx.moveTo(0, height * 0.75);
  ctx.lineTo(width, height * 0.75);
  ctx.stroke();

  ctx.strokeStyle = tokens.gridMajor;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
}

export function Oscilloscope() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { treatment } = useTreatment();
  const active = useSynthStore((s) => s.activeNotes.length);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const data = new Float32Array(2048);
    // Treatment tokens are stable between switches; keep style reads out of RAF.
    const tokens = readCanvasTreatmentTokens(canvas);
    let needsClear = true;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      const pw = Math.floor(w * dpr);
      const ph = Math.floor(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
        needsClear = true;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // A new treatment or canvas size starts with a clean, opaque plot.
      ctx.fillStyle = needsClear ? tokens.plot : tokens.scopeFade;
      ctx.fillRect(0, 0, w, h);
      needsClear = false;
      drawScopeGrid(ctx, w, h, tokens);

      const analyser = synth.getAnalyser();
      if (!analyser) {
        ctx.strokeStyle = tokens.scopeIdle;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        return;
      }

      const n = analyser.fftSize;
      analyser.getFloatTimeDomainData(data.subarray(0, n));

      let peak = 0;
      for (let i = 0; i < n; i++) {
        const a = Math.abs(data[i] ?? 0);
        if (a > peak) peak = a;
      }

      const sr = synth.getContext()?.sampleRate ?? 44100;
      const viewWanted = Math.round(sr * 0.01);
      const searchN = Math.max(8, n - viewWanted);
      const start = peak < 0.02 ? 0 : findRisingZero(data.subarray(0, searchN), peak);
      const viewN = Math.min(viewWanted, n - start);

      ctx.lineWidth = tokens.scopeWidth;
      ctx.strokeStyle = tokens.scopeTrace;
      ctx.shadowColor = tokens.scopeTrace;
      ctx.shadowBlur = peak > 0.02 ? tokens.scopeGlow : 0;
      ctx.beginPath();
      const slice = w / Math.max(1, viewN - 1);
      for (let i = 0; i < viewN; i++) {
        const v = data[start + i] ?? 0;
        const y = h / 2 - v * (h * 0.42);
        const x = i * slice;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [treatment]);

  return (
    <div className="relative overflow-hidden rounded-lg bg-plot shadow-border">
      <div className="pointer-events-none absolute inset-x-3 top-2 z-10 flex justify-between font-mono text-xs uppercase tracking-[0.08em] text-muted">
        <span>Output</span>
        <span className="tabular-nums">{active} voice{active === 1 ? "" : "s"}</span>
      </div>
      <canvas
        ref={canvasRef}
        className="h-24 w-full md:h-40"
        aria-label="Live output oscilloscope"
      />
    </div>
  );
}
