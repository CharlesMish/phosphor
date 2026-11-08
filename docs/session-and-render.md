# Session files and phrase rendering

Phosphor keeps one session document, `phosphor-session` version 1. Saving, the
browser's local copy, and phrase rendering all read that document. It is a
snapshot of the instrument store plus the completed note loop. It is not a
second synthesizer and it is not a recording of live playback.

## What a session stores

- The current cycle, its preset label, and whether it has been drawn.
- Cycle A and Cycle B, the morph position, and whether morph is the live cycle.
  A live morph must contain both endpoints, and the saved cycle samples must be
  exactly the blend those endpoints produce. Loading does not renormalize them.
- Drive, Chorus, and Space shapes, with their preset labels, amounts, mixes,
  Drive Safe, Chorus period, Space seed, Metal, and length.
- Envelope attack and release, low-pass, master volume, and keyboard octave.
- Motion's path, mode, tempo, length, and each destination's enable flag and
  range. Reversed ranges are stored as written.
- The note loop's bar length and the completed note events, in beats.

The open editor (Cycle, Motion, Drive, Chorus, or Space) is stored so the same
panel is showing after a reload.

## What a session does not store

- Undo and redo history.
- Whether Motion or the note loop is playing, and where the playhead is.
- Keys that are held, or the audio context.
- The presentation treatment.
- Space's display curve. It is rebuilt from the contour and seed.
- A recording that has not finished. Record clears the previous take in memory
  immediately. The partial performance is never written. Autosave waits while
  recording, so the last completed session stays in browser storage until the
  new take completes, the recording is stopped or cleared, or the tab hides
  after that discard. Stop during recording still discards the partial take.
  Reloading during a recording restores the last completed session, not the
  notes captured so far.

Local storage uses the key `phosphor.session.v1`. A file that fails validation
is not applied: the sounding session, including a take that is already loaded,
stays as it was. An unreadable local copy is removed so the instrument can open
on its defaults. Restoring a session stops Motion and the note loop, releases
scheduled notes, and does not start playback.

Values outside the controls' ranges are rejected rather than clamped. Unknown
fields and unsupported versions are rejected for the same reason.

## Render from start

Audition and Export WAV render the saved notes and Motion through a new
instance of the production synth: the same voices, filter, Drive, Chorus,
Space, master volume, and output safety stage. The buffer is 32-bit float
stereo at 48 kHz. Encoding the WAV does not change those samples.

Time zero is the first beat. Leading rests are silence. There is no count-in.
The file is one pass of the note loop plus a tail. It does not loop, and it is
not a take of what was coming out of the speakers.

Motion always starts at the beginning of its path on that same clock, including
when Motion was stopped in the session. The offline graph is built at those
starting amounts, so the phrase does not fade in from the engine's class defaults. Cycle A/B, Drive Amount, Chorus mix,
and Space mix follow their saved routes, including reversed ranges. A route
that is off keeps the saved manual value. Effects-only Motion is included when
those effect routes are on; Cycle Motion needs both A and B and does not invent
endpoints. The saved morph slider is used only when the Cycle route is off.

### Notes at the boundary

A note-on without a note-off is released at the last beat of the phrase, the
same rule the looper uses when a held key reaches the end of the recording
window. The release then rings into the tail. A note whose release is at or
before its attack is kept in the session and produces no voice.

### Tail

The tail is the saved release, plus the Space length when the saved Space mix
is above zero or Space Motion can leave zero, plus 30 ms of voice-source stop
padding and 24 ms for the longest chorus delay. The file is that long, rounded
up to the next sample. Silence at the end is not trimmed and the buffer is not
normalized.

### Control sampling

Notes are placed on the audio clock at their beat times. The renderer queues
each note once it is inside the live looper's 100 ms lookahead, and only while
the note's attack is still in the future, so the onset stays on the beat.
Motion is sampled at 30 Hz. Those times, and the note-queue times, are snapped
to the offline render quantum of 128 frames (about 2.7 ms at 48 kHz). The value
used is the Motion frame at the quantum's actual audio time.

Cycle morph then ramps its two gains linearly over 32 ms. Chorus mix and Space
mix ease with the existing 30 ms gain smoothing. Drive replaces its transfer
curve on that control frame, with the existing guard-gain smoothing. Voice
retirement and the polyphonic bus recovery also happen on those ticks, because
an offline render cannot trust oscillator ended events for musical time. This
is a deterministic control-rate schedule. It is not sample-accurate automation.

### What stays different from ordinary playback

Ordinary Play still loops the take on its own clock. Motion Play still has its
own phase. Neither is pulled into the render clock, and the render is not a
recording of them.

Live playback uses a 25 ms timer, a 20 ms start lead, and can skip attacks
after a long stall. The render schedules the whole phrase ahead of time and
does not skip. Live Space is built at the device sample rate; the file is
48 kHz, so a 44.1 kHz device can sound different from the file when played
live. Audition plays the rendered buffer, so it matches the WAV even when both
differ from ordinary live playback. Starting audition or export stops the
ordinary loop and Motion so they are not heard on top of the phrase. Cancelling,
editing the session, or starting another render discards an unfinished buffer.
It is not downloaded and it is not auditioned.
