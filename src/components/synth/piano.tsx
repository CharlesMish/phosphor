import { useCallback, useEffect, useRef } from "react";
import { synth } from "@/lib/synth/engine";
import { useSynthStore } from "@/lib/synth/store";
import {
  BASE_MIDI,
  OFFSET_TO_HINT,
  VISIBLE_SEMITONES,
  isBlackKey,
  midiName,
} from "@/lib/synth/keyboard-map";
import { cn } from "@/lib/utils";

function whitesInRange(start: number, end: number) {
  const out: number[] = [];
  for (let m = start; m <= end; m++) {
    if (!isBlackKey(m)) out.push(m);
  }
  return out;
}

function midiFromPoint(clientX: number, clientY: number): number | null {
  const el = document.elementFromPoint(clientX, clientY);
  if (!(el instanceof Element)) return null;
  const key = el.closest("[data-midi]");
  if (!key) return null;
  const midi = Number(key.getAttribute("data-midi"));
  return Number.isFinite(midi) ? midi : null;
}

function midiFromTarget(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const key = target.closest("[data-midi]");
  if (!key) return null;
  const midi = Number(key.getAttribute("data-midi"));
  return Number.isFinite(midi) ? midi : null;
}

export function Piano() {
  const octave = useSynthStore((s) => s.octave);
  const active = useSynthStore((s) => s.activeNotes);
  const start = BASE_MIDI + octave * 12;
  const end = start + VISIBLE_SEMITONES;
  const whites = whitesInRange(start, end);
  const blacks: number[] = [];
  for (let m = start; m <= end; m++) {
    if (isBlackKey(m)) blacks.push(m);
  }

  const heldByPointer = useRef(new Map<number, number>());
  const activeSet = new Set(active);

  const play = useCallback((midi: number) => {
    synth.unlock();
    synth.noteOn(midi);
  }, []);

  const stop = useCallback((midi: number) => {
    synth.noteOff(midi);
  }, []);

  const releasePointer = useCallback(
    (pointerId: number) => {
      const midi = heldByPointer.current.get(pointerId);
      heldByPointer.current.delete(pointerId);
      if (midi !== undefined) stop(midi);
    },
    [stop],
  );

  useEffect(() => {
    const end = (e: PointerEvent) => releasePointer(e.pointerId);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [releasePointer]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const midi = midiFromTarget(e.target) ?? midiFromPoint(e.clientX, e.clientY);
    if (midi === null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const prev = heldByPointer.current.get(e.pointerId);
    if (prev !== undefined && prev !== midi) stop(prev);
    heldByPointer.current.set(e.pointerId, midi);
    play(midi);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!heldByPointer.current.has(e.pointerId)) return;
    const midi = midiFromPoint(e.clientX, e.clientY);
    const prev = heldByPointer.current.get(e.pointerId);
    if (midi === null || midi === prev) return;
    if (prev !== undefined) stop(prev);
    heldByPointer.current.set(e.pointerId, midi);
    play(midi);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    releasePointer(e.pointerId);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  return (
    <div
      className="relative isolate h-28 w-full cursor-pointer touch-none select-none sm:h-32 md:h-36"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
    >
      <div className="flex h-full w-full gap-px">
        {whites.map((midi) => {
          const on = activeSet.has(midi);
          const offset = midi - start;
          const hint = OFFSET_TO_HINT[offset];
          const name = midiName(midi);
          const showName = name.startsWith("C") && !name.includes("#");
          return (
            <div
              key={midi}
              data-midi={midi}
              aria-label={name}
              aria-pressed={on}
              role="button"
              className={cn(
                "relative flex min-w-0 flex-1 flex-col items-center justify-end rounded-b-md pb-2 pt-8",
                "transition-[transform,background-color,box-shadow] duration-75 ease-out origin-top",
                on
                  ? "translate-y-0.5 bg-key-white-active text-key-white-active-ink shadow-inner"
                  : "bg-key-white text-key-ink/70",
              )}
            >
              {hint && (
                <span className="pointer-events-none absolute top-2 hidden font-mono text-[10px] opacity-40 sm:block">
                  {hint}
                </span>
              )}
              {showName && (
                <span className="pointer-events-none max-w-full truncate px-0.5 font-mono text-[10px] tracking-wide">
                  {name}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-0">
        {blacks.map((midi) => {
          const whitesBefore = whites.filter((w) => w < midi).length;
          const leftPct = (whitesBefore / whites.length) * 100;
          const widthPct = (1 / whites.length) * 62;
          const on = activeSet.has(midi);
          const offset = midi - start;
          const hint = OFFSET_TO_HINT[offset];
          return (
            <div
              key={midi}
              data-midi={midi}
              aria-label={midiName(midi)}
              aria-pressed={on}
              role="button"
              className={cn(
                "pointer-events-auto absolute top-0 z-10 h-[58%] rounded-b-md",
                "transition-[transform,background-color] duration-75 ease-out origin-top",
                on
                  ? "translate-y-0.5 bg-key-black-active text-key-black-active-ink"
                  : "bg-key-black text-key-black-ink",
              )}
              style={{
                left: `calc(${leftPct}% - ${widthPct / 2}%)`,
                width: `${widthPct}%`,
              }}
            >
              {hint && (
                <span className="pointer-events-none absolute inset-x-0 top-1.5 hidden text-center font-mono text-[9px] opacity-50 sm:block">
                  {hint}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
