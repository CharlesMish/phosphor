import { useState, useSyncExternalStore } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { noteLooper } from '@/lib/synth/looper-runtime';
import { LOOP_BARS, type LoopBars } from '@/lib/synth/note-looper';
import { MOTION_BPM_MIN, MOTION_BPM_MAX } from '@/lib/synth/motion';
import { useSynthStore } from '@/lib/synth/store';
import type { RenderMode } from '@/lib/synth/loop-render';
import { exportTakeWav } from '@/lib/synth/render-export';
import { downloadFile } from './sound-shelf';

export function NoteLooperControls() {
  const state = useSyncExternalStore(noteLooper.subscribe, noteLooper.getSnapshot);
  const bpm = useSynthStore(s => s.motionBpm);
  const setBpm = useSynthStore(s => s.setMotionBpm);
  const running = state.state === 'playing' || state.state === 'recording';
  const motionPlaying = useSynthStore(s => s.motionPlaying);
  const [mode, setMode] = useState<RenderMode>('seamless');
  const [render, setRender] = useState<{ busy: boolean; text: string }>({ busy: false, text: '' });
  const exportWav = async () => {
    setRender({ busy: true, text: 'Rendering…' });
    try {
      const { file, result } = await exportTakeWav(mode);
      downloadFile(file);
      const seconds = result.channels[0]!.length / result.sampleRate;
      setRender({ busy: false, text: `WAV ready · ${seconds.toFixed(1)} s${result.motion ? ' · Motion' : ''}` });
    } catch (error) {
      setRender({ busy: false, text: error instanceof Error ? error.message : 'Render failed.' });
    }
  };
  const field = 'h-9 rounded-md bg-surface-2 px-2 text-xs text-fg shadow-border outline-none focus-visible:ring-2 focus-visible:ring-focus/50';
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-border pb-2" role="group" aria-label="Note looper">
      <span className="mr-1 font-mono text-xs uppercase tracking-wider text-muted">Note loop</span>
      <label className="flex items-center gap-1.5 font-mono text-xs text-faint">
        BPM
        <input className={`${field} w-16 text-center tabular-nums`} aria-label="Shared BPM"
          title="Shared with Motion. Changing tempo stops playback; press Play to restart."
          type="number" min={MOTION_BPM_MIN} max={MOTION_BPM_MAX} step={1} value={bpm}
          onChange={e => { if (Number.isFinite(e.currentTarget.valueAsNumber)) setBpm(e.currentTarget.valueAsNumber); }} />
      </label>
      <select className={field} aria-label="Note loop length" value={state.bars}
        title="Changing length clears the take."
        onChange={e => noteLooper.setBars(Number(e.currentTarget.value) as LoopBars)}>
        {LOOP_BARS.map(bars => <option key={bars} value={bars}>{bars} {bars === 1 ? 'bar' : 'bars'}</option>)}
      </select>
      <Button variant={state.state === 'recording' ? 'solid' : 'outline'} aria-label="Record note loop"
        aria-pressed={state.state === 'recording'} onClick={() => noteLooper.record()}>Record</Button>
      <Button aria-label={running ? 'Stop note loop' : 'Play note loop'} disabled={!running && !state.hasTake}
        onClick={() => running ? noteLooper.stop() : noteLooper.play()}>{running ? 'Stop' : 'Play'}</Button>
      <Button variant="subtle" disabled={!running && !state.hasTake}
        aria-label="Clear note loop" onClick={() => noteLooper.clear()}>Clear</Button>
      <span className="font-mono text-xs text-muted" role="status">
        {state.state === 'empty' ? '4/4 · Ready' : state.state === 'recording' ? 'Recording' : state.state === 'playing' ? 'Looping' : 'Stopped'}
      </span>
      <progress className="h-1 w-20 accent-active" aria-label="Note loop progress" max={1} value={state.progress} />
      <span className="flex flex-wrap items-center gap-2 sm:ml-auto" role="group" aria-label="Render the take">
        <select className={field} aria-label="WAV length" value={mode}
          title="Seamless: exactly one loop, with tails wrapped to the start so it repeats without a gap. Take: one pass plus its release and Space tail."
          onChange={e => setMode(e.currentTarget.value as RenderMode)}>
          <option value="seamless">Seamless loop</option>
          <option value="take">Take + tail</option>
        </select>
        <Button variant="outline" disabled={!state.hasTake || state.state === 'recording' || render.busy}
          title={motionPlaying ? 'Renders the take with the current sound. Motion is playing, so it is included from bar 1.'
            : 'Renders the take with the current sound as a 32-bit float stereo WAV.'}
          onClick={() => void exportWav()}>
          <Download className="size-3.5" aria-hidden />
          WAV
        </Button>
        <span className="font-mono text-xs text-muted" role="status" aria-live="polite">{render.text}</span>
      </span>
    </div>
  );
}
