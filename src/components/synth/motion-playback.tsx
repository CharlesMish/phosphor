import { useEffect } from "react";
import { synth } from "@/lib/synth/engine";
import { motionFrameAtTime } from "@/lib/synth/motion";
import { useSynthStore } from "@/lib/synth/store";

const CONTROL_INTERVAL_MS = 1000 / 30;

function clockSeconds() {
  return synth.getContext()?.currentTime ?? performance.now() / 1000;
}

export function MotionPlaybackController() {
  const playing = useSynthStore((s) => s.motionPlaying);
  const runId = useSynthStore((s) => s.motionRunId);

  useEffect(() => {
    if (!playing) return;
    const state = useSynthStore.getState();
    const path = state.motionPath.slice();
    const timing = {
      bpm: state.motionBpm,
      beats: state.motionBeats,
      mode: state.motionMode,
    } as const;
    const startedAt = clockSeconds();

    const tick = () => {
      const frame = motionFrameAtTime(path, clockSeconds() - startedAt, timing);
      useSynthStore
        .getState()
        .setMotionPlaybackPosition(frame.position, frame.progress, frame.complete, runId);
    };

    const timer = window.setInterval(tick, CONTROL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing, runId]);

  return null;
}
