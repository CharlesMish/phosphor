import { useCallback, useEffect, useRef } from "react";
import {
  readCanvasTreatmentTokens,
  type CanvasTreatmentTokens,
} from "@/lib/presentation/canvas-tokens";
import { useTreatment } from "@/lib/presentation/treatment";
import { synth } from "@/lib/synth/engine";
import {
  MOTION_SIZE,
  motionDurationSeconds,
  sampleMotionPath,
} from "@/lib/synth/motion";
import { useSynthStore } from "@/lib/synth/store";
import { EditorTabs } from "./editor-tabs";

const PAD_X = 44;
const PAD_Y = 40;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function formatSeconds(seconds: number) {
  return `${Number(seconds.toFixed(2))} s`;
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

export function MotionEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { treatment } = useTreatment();
  const motionPath = useSynthStore((s) => s.motionPath);
  const motionPlaying = useSynthStore((s) => s.motionPlaying);
  const motionProgress = useSynthStore((s) => s.motionProgress);
  const motionBpm = useSynthStore((s) => s.motionBpm);
  const motionBeats = useSynthStore((s) => s.motionBeats);
  const armed = useSynthStore((s) => Boolean(s.slotA && s.slotB));
  const setLiveMotionPath = useSynthStore((s) => s.setLiveMotionPath);
  const finishMotionGesture = useSynthStore((s) => s.finishMotionGesture);
  const auditionMotion = useSynthStore((s) => s.auditionMotion);
  const stopMotion = useSynthStore((s) => s.stopMotion);

  const pathRef = useRef(motionPath);
  const armedRef = useRef(armed);
  const playingRef = useRef(motionPlaying);
  const progressRef = useRef(motionProgress);
  const durationRef = useRef(motionDurationSeconds(motionBpm, motionBeats));
  const drawingRef = useRef(false);
  const lastIndexRef = useRef<number | null>(null);
  const lastValueRef = useRef<number | null>(null);
  const originRef = useRef<number[] | null>(null);

  armedRef.current = armed;
  playingRef.current = motionPlaying;
  progressRef.current = motionProgress;
  durationRef.current = motionDurationSeconds(motionBpm, motionBeats);
  if (!drawingRef.current) pathRef.current = motionPath;

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

    const innerW = w - PAD_X * 2;
    const innerH = h - PAD_Y * 2;
    const xAt = (t: number) => PAD_X + clamp(t, 0, 1) * innerW;
    const yAt = (value: number) => PAD_Y + (1 - clamp(value, 0, 1)) * innerH;

    drawPlotGrid(ctx, PAD_X, PAD_Y, innerW, innerH, tokens);

    const path = pathRef.current;
    const n = path.length || MOTION_SIZE;
    ctx.save();
    ctx.globalAlpha = armedRef.current ? 1 : 0.32;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = tokens.tracePrimary;
    ctx.lineWidth = tokens.traceWidth;
    ctx.shadowColor = tokens.tracePrimary;
    ctx.shadowBlur = armedRef.current ? tokens.traceGlow : 0;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = xAt(i / Math.max(1, n - 1));
      const y = yAt(path[i] ?? 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    if (playingRef.current) {
      const progress = progressRef.current;
      const x = xAt(progress);
      const y = yAt(sampleMotionPath(path, progress));
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.strokeStyle = tokens.traceSecondary;
      ctx.fillStyle = tokens.traceSecondary;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(x, PAD_Y);
      ctx.lineTo(x, PAD_Y + innerH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = tokens.annotation;
    ctx.font = "11px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("B", 14, yAt(1));
    ctx.fillText("A", 14, yAt(0));
    ctx.textBaseline = "top";
    ctx.fillText("0 s", PAD_X, PAD_Y + innerH + 8);
    ctx.textAlign = "right";
    ctx.fillText(formatSeconds(durationRef.current), PAD_X + innerW, PAD_Y + innerH + 8);
  }, []);

  useEffect(() => {
    pathRef.current = motionPath;
    armedRef.current = armed;
    playingRef.current = motionPlaying;
    progressRef.current = motionProgress;
    durationRef.current = motionDurationSeconds(motionBpm, motionBeats);
    paint();
  }, [motionPath, armed, motionPlaying, motionProgress, motionBpm, motionBeats, paint]);

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
    const innerW = Math.max(1, rect.width - PAD_X * 2);
    const innerH = Math.max(1, rect.height - PAD_Y * 2);
    const x = clamp((e.clientX - rect.left - PAD_X) / innerW, 0, 1);
    const y = clamp((e.clientY - rect.top - PAD_Y) / innerH, 0, 1);
    return {
      index: clamp(Math.round(x * (MOTION_SIZE - 1)), 0, MOTION_SIZE - 1),
      value: clamp(1 - y, 0, 1),
    };
  };

  const paintSpan = (from: number, to: number, v0: number, v1: number, path: number[]) => {
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    const span = Math.max(1, b - a);
    for (let i = a; i <= b; i++) {
      const u = (i - a) / span;
      const startV = from <= to ? v0 : v1;
      const endV = from <= to ? v1 : v0;
      path[i] = startV + (endV - startV) * u;
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!armedRef.current) return;
    synth.unlock();
    stopMotion();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    originRef.current = pathRef.current.slice();
    const hit = eventToHit(e);
    if (!hit) return;
    const path = pathRef.current.slice();
    path[hit.index] = hit.value;
    pathRef.current = path;
    lastIndexRef.current = hit.index;
    lastValueRef.current = hit.value;
    setLiveMotionPath(path);
    auditionMotion(hit.value, false);
    paint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const hit = eventToHit(e);
    if (!hit) return;
    const path = pathRef.current.slice();
    const last = lastIndexRef.current;
    if (last === null || last === hit.index) {
      path[hit.index] = hit.value;
    } else {
      paintSpan(last, hit.index, path[last] ?? hit.value, hit.value, path);
    }
    pathRef.current = path;
    lastIndexRef.current = hit.index;
    lastValueRef.current = hit.value;
    setLiveMotionPath(path);
    auditionMotion(hit.value, false);
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
    const origin = originRef.current ?? pathRef.current;
    const lastValue = lastValueRef.current;
    originRef.current = null;
    lastValueRef.current = null;
    finishMotionGesture(origin, pathRef.current);
    if (lastValue !== null) auditionMotion(lastValue, true);
  };

  return (
    <div className="relative flex min-h-32 flex-1 flex-col overflow-hidden rounded-xl bg-plot shadow-border md:min-h-0">
      <div className="pointer-events-none absolute inset-x-3 top-2 z-10 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <EditorTabs />
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-faint sm:inline">
            Motion · A/B trajectory
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
          {motionBeats} {motionBeats === 1 ? "beat" : "beats"} ·{" "}
          {formatSeconds(motionDurationSeconds(motionBpm, motionBeats))}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="h-full min-h-32 w-full flex-1 touch-none cursor-crosshair md:min-h-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDraw}
        onPointerCancel={endDraw}
        aria-label="Draw A to B motion trajectory"
        aria-disabled={!armed}
      />
      {!armed && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-xs tracking-wide text-muted/80">
          Capture A + B to use Motion
        </p>
      )}
    </div>
  );
}
