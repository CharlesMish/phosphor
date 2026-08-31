import { useCallback, useEffect, useRef } from "react";
import {
  readCanvasTreatmentTokens,
  type CanvasTreatmentTokens,
} from "@/lib/presentation/canvas-tokens";
import { useTreatment } from "@/lib/presentation/treatment";
import { useSynthStore } from "@/lib/synth/store";
import { WAVE_SIZE } from "@/lib/synth/waveform";
import {
  SPACE_SECONDS,
  SPACE_SIZE,
  buildSpaceView,
  sampleContour,
} from "@/lib/synth/space";
import { synth } from "@/lib/synth/engine";
import { cn } from "@/lib/utils";
import { EditorTabs } from "./editor-tabs";

const PAD_X = 44;
const PAD_Y = 40;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function drawPlotGrid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  tokens: CanvasTreatmentTokens,
) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = tokens.gridMinor;
  ctx.beginPath();
  for (let g = 1; g < 16; g += 2) {
    const gx = x + (g / 16) * width;
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + height);
  }
  for (let g = 1; g < 8; g += 2) {
    const gy = y + (g / 8) * height;
    ctx.moveTo(x, gy);
    ctx.lineTo(x + width, gy);
  }
  ctx.stroke();

  ctx.strokeStyle = tokens.gridMajor;
  ctx.beginPath();
  for (let g = 0; g <= 8; g++) {
    const gx = x + (g / 8) * width;
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + height);
  }
  for (let g = 0; g <= 4; g++) {
    const gy = y + (g / 4) * height;
    ctx.moveTo(x, gy);
    ctx.lineTo(x + width, gy);
  }
  ctx.stroke();
}

function wrapSample(wave: number[], i: number) {
  const n = wave.length;
  if (n === 0) return 0;
  return wave[((i % n) + n) % n] ?? 0;
}

export function WaveformEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const domain = useSynthStore((s) => s.domain);
  const { treatment } = useTreatment();
  const samples = useSynthStore((s) => s.samples);
  const spaceContour = useSynthStore((s) => s.spaceContour);
  const spaceView = useSynthStore((s) => s.spaceView);
  const hasDrawn = useSynthStore((s) => s.hasDrawn);
  const spaceHasDrawn = useSynthStore((s) => s.spaceHasDrawn);
  const morphLive = useSynthStore((s) => s.morphLive);
  const morphArmed = useSynthStore((s) => Boolean(s.slotA && s.slotB));
  const setLiveSamples = useSynthStore((s) => s.setLiveSamples);
  const finishGesture = useSynthStore((s) => s.finishGesture);
  const setLiveContour = useSynthStore((s) => s.setLiveContour);
  const finishSpaceGesture = useSynthStore((s) => s.finishSpaceGesture);
  const markDrawn = useSynthStore((s) => s.markDrawn);
  const markSpaceDrawn = useSynthStore((s) => s.markSpaceDrawn);

  const liveRef = useRef<number[]>(samples);
  const contourRef = useRef<number[]>(spaceContour);
  const viewRef = useRef<number[]>(spaceView);
  const domainRef = useRef(domain);
  const drawingRef = useRef(false);
  const lastIndexRef = useRef<number | null>(null);
  const originRef = useRef<number[] | null>(null);

  domainRef.current = domain;
  if (!drawingRef.current) {
    liveRef.current = samples;
    contourRef.current = spaceContour;
    viewRef.current = spaceView;
  }

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const pw = Math.floor(w * dpr);
    const ph = Math.floor(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const tokens = readCanvasTreatmentTokens(canvas);

    ctx.fillStyle = tokens.plot;
    ctx.fillRect(0, 0, w, h);

    const padX = PAD_X;
    const padY = PAD_Y;
    const innerW = w - padX * 2;
    const innerH = h - padY * 2;
    const yAt = (v: number) => padY + (0.5 - v * 0.5) * innerH;
    const yEnergy = (e: number) => padY + (1 - clamp(e, 0, 1)) * innerH;
    const space = domainRef.current === "space";

    drawPlotGrid(ctx, padX, padY, innerW, innerH, tokens);

    if (space) {
      const contour = contourRef.current;
      const view = viewRef.current;
      const cn = contour.length || SPACE_SIZE;
      const vn = view.length || SPACE_SIZE;
      const xLin = (i: number, n: number) => padX + (i / Math.max(1, n - 1)) * innerW;

      ctx.strokeStyle = tokens.axis;
      ctx.beginPath();
      ctx.moveTo(padX, padY + innerH);
      ctx.lineTo(padX + innerW, padY + innerH);
      ctx.stroke();

      ctx.save();
      ctx.globalAlpha = tokens.spaceFillAlpha;
      ctx.fillStyle = tokens.spaceFill;
      ctx.beginPath();
      ctx.moveTo(padX, padY + innerH);
      for (let i = 0; i < cn; i++) {
        ctx.lineTo(xLin(i, cn), yEnergy(contour[i] ?? 0));
      }
      ctx.lineTo(padX + innerW, padY + innerH);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = tokens.microstructureAlpha;
      ctx.strokeStyle = tokens.traceSecondary;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < vn; i++) {
        const t = i / Math.max(1, vn - 1);
        const e = sampleContour(contour, t);
        const ir = view[i] ?? 0;
        const span = e * innerH;
        const yTop = padY + innerH - span;
        const y =
          span < 0.5
            ? padY + innerH
            : yTop + clamp((e - ir) / (2 * Math.max(e, 1e-6)), 0, 1) * span;
        const x = xLin(i, vn);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = tokens.tracePrimary;
      ctx.lineWidth = tokens.traceWidth;
      ctx.shadowColor = tokens.tracePrimary;
      ctx.shadowBlur = tokens.traceGlow;
      ctx.beginPath();
      for (let i = 0; i < cn; i++) {
        const x = xLin(i, cn);
        const y = yEnergy(contour[i] ?? 0);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = tokens.annotation;
      ctx.font = "11px 'IBM Plex Mono', ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("1", 14, yEnergy(1));
      ctx.fillText("0", 14, yEnergy(0));
      ctx.textBaseline = "top";
      ctx.fillText("0 s", padX, padY + innerH + 8);
      ctx.textAlign = "right";
      ctx.fillText(`${SPACE_SECONDS.toFixed(1)} s`, padX + innerW, padY + innerH + 8);
    } else {
      ctx.strokeStyle = tokens.axis;
      ctx.beginPath();
      ctx.moveTo(padX, yAt(0));
      ctx.lineTo(padX + innerW, yAt(0));
      ctx.stroke();

      const wave = liveRef.current;
      const n = wave.length || WAVE_SIZE;
      const ghost = Math.max(8, Math.round(n * 0.08));
      const xAt = (i: number, count: number) => padX + (i / count) * innerW;

      const strokeWave = (
        from: number,
        to: number,
        color: string,
        alpha: number,
        width: number,
        glow: boolean,
      ) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.shadowColor = glow ? color : "transparent";
        ctx.shadowBlur = glow ? tokens.traceGlow : 0;
        ctx.beginPath();
        for (let i = from; i <= to; i++) {
          const x = xAt(i, n);
          const y = yAt(wrapSample(wave, i));
          if (i === from) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      };

      strokeWave(
        -ghost,
        0,
        tokens.traceGhost,
        tokens.ghostAlpha,
        tokens.ghostWidth,
        false,
      );
      strokeWave(
        n,
        n + ghost,
        tokens.traceGhost,
        tokens.ghostAlpha,
        tokens.ghostWidth,
        false,
      );
      strokeWave(0, n, tokens.tracePrimary, 1, tokens.traceWidth, true);

      ctx.fillStyle = tokens.tracePrimary;
      ctx.beginPath();
      ctx.arc(xAt(0, n), yAt(wrapSample(wave, 0)), 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(xAt(n, n), yAt(wrapSample(wave, 0)), 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = tokens.annotation;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(padX, padY);
      ctx.lineTo(padX, padY + innerH);
      ctx.moveTo(padX + innerW, padY);
      ctx.lineTo(padX + innerW, padY + innerH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = tokens.annotation;
      ctx.font = "11px 'IBM Plex Mono', ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("+1", 8, yAt(1));
      ctx.fillText("0", 12, yAt(0));
      ctx.fillText("−1", 8, yAt(-1));
    }
  }, []);

  useEffect(() => {
    liveRef.current = samples;
    contourRef.current = spaceContour;
    viewRef.current = spaceView;
    domainRef.current = domain;
    paint();
  }, [samples, spaceContour, spaceView, domain, paint]);

  useEffect(() => {
    paint();
  }, [treatment, paint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => paint());
    ro.observe(canvas);
    paint();
    return () => ro.disconnect();
  }, [paint]);

  const eventToHit = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const innerW = rect.width - PAD_X * 2;
    const innerH = rect.height - PAD_Y * 2;
    const x = clamp((e.clientX - rect.left - PAD_X) / innerW, 0, 1);
    const y = clamp((e.clientY - rect.top - PAD_Y) / innerH, 0, 1);
    if (domainRef.current === "space") {
      const index = clamp(Math.round(x * (SPACE_SIZE - 1)), 0, SPACE_SIZE - 1);
      return { index, value: clamp(1 - y, 0, 1), size: SPACE_SIZE };
    }
    const index = clamp(Math.round(x * WAVE_SIZE) % WAVE_SIZE, 0, WAVE_SIZE - 1);
    const value = clamp(1 - 2 * y, -1, 1);
    return { index, value, size: WAVE_SIZE };
  };

  const paintSpan = (from: number, to: number, v0: number, v1: number, wave: number[]) => {
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    const span = Math.max(1, b - a);
    for (let i = a; i <= b; i++) {
      const u = (i - a) / span;
      const startV = from <= to ? v0 : v1;
      const endV = from <= to ? v1 : v0;
      wave[i] = startV + (endV - startV) * u;
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    synth.unlock();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const space = domainRef.current === "space";
    if (space) markSpaceDrawn();
    else markDrawn();
    const source = space ? contourRef.current : liveRef.current;
    originRef.current = source.slice();
    const hit = eventToHit(e);
    if (!hit) return;
    const wave = source.slice();
    wave[hit.index] = hit.value;
    lastIndexRef.current = hit.index;
    if (space) {
      contourRef.current = wave;
      viewRef.current = buildSpaceView(wave, useSynthStore.getState().spaceSeed);
      setLiveContour(wave);
    } else {
      liveRef.current = wave;
      setLiveSamples(wave, false);
    }
    paint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const hit = eventToHit(e);
    if (!hit) return;
    const space = domainRef.current === "space";
    const wave = (space ? contourRef.current : liveRef.current).slice();
    const last = lastIndexRef.current;
    if (last === null || last === hit.index) {
      wave[hit.index] = hit.value;
    } else {
      paintSpan(last, hit.index, wave[last] ?? hit.value, hit.value, wave);
    }
    lastIndexRef.current = hit.index;
    if (space) {
      contourRef.current = wave;
      viewRef.current = buildSpaceView(wave, useSynthStore.getState().spaceSeed);
      setLiveContour(wave);
    } else {
      liveRef.current = wave;
      setLiveSamples(wave, false);
    }
    paint();
  };

  const endDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastIndexRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const space = domainRef.current === "space";
    const origin = originRef.current ?? (space ? contourRef.current : liveRef.current);
    originRef.current = null;
    if (space) finishSpaceGesture(origin, contourRef.current);
    else finishGesture(origin, liveRef.current);
  };

  const space = domain === "space";
  const title = space
    ? "Space · impulse response"
    : `Oscillator · ${morphArmed && !morphLive ? "custom" : "1 cycle"}`;
  const showHint = space ? !spaceHasDrawn : !hasDrawn;

  return (
    <div className="relative flex min-h-32 flex-1 flex-col overflow-hidden rounded-xl bg-plot shadow-border md:min-h-0">
      <div className="pointer-events-none absolute inset-x-3 top-2 z-10 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <EditorTabs />
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-faint sm:inline">
            {title}
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
          {space ? `0 s → ${SPACE_SECONDS.toFixed(1)} s` : "−1 ↔ +1"}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="h-full min-h-32 w-full flex-1 touch-none cursor-crosshair md:min-h-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDraw}
        onPointerCancel={endDraw}
        aria-label={space ? "Draw space impulse response" : "Draw oscillator waveform"}
      />
      {showHint && (
        <p
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center justify-center",
            "font-mono text-xs tracking-wide text-muted/80",
          )}
        >
          {space ? "Drag to draw this response" : "Drag to redraw this cycle"}
        </p>
      )}
    </div>
  );
}
