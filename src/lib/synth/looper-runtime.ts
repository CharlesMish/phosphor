import { synth } from './engine';
import { PerformanceInput } from './performance';
import { NoteLooper } from './note-looper';
import { useSynthStore } from './store';

export const performanceInput = new PerformanceInput({
  unlock: () => synth.unlock(),
  now: () => synth.getContext()?.currentTime ?? 0,
  noteOn: midi => synth.noteOn(midi),
  noteOff: midi => synth.noteOff(midi),
  limitNote: (midi, end) => synth.limitLiveNote(midi, end),
});
export const noteLooper = new NoteLooper({
  unlock: () => synth.unlock(),
  now: () => synth.getContext()?.currentTime ?? 0,
  running: () => synth.getContext()?.state === 'running',
  beginRun: run => synth.beginScheduledRun(run),
  schedule: (run, id, midi, start, end) => synth.scheduleNote(run, id, midi, start, end),
  cancel: () => synth.cancelScheduledNotes(),
  refresh: () => synth.refreshScheduledVoices(),
  interval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: timer => window.clearInterval(timer as number),
}, performanceInput, useSynthStore.getState().motionBpm);

/** Mounted once by the instrument. Both BPM controls use the existing store field. */
export function connectLooperTempo() {
  noteLooper.setBpm(useSynthStore.getState().motionBpm);
  return useSynthStore.subscribe((state, previous) => {
    if (state.motionBpm !== previous.motionBpm) noteLooper.setBpm(state.motionBpm);
  });
}
export function panicPerformance() {
  noteLooper.stop();
  useSynthStore.getState().stopMotion();
  synth.allNotesOff();
}
