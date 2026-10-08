#ifndef CYCLE_SYNTH_H
#define CYCLE_SYNTH_H
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif

enum { PC_WAVE_SIZE = 256 };
typedef struct PCSynth PCSynth;

/* One control-thread producer and one audio-thread consumer. */
PCSynth *pc_create(double sample_rate);
void pc_destroy(PCSynth *synth); /* Only after rendering has stopped. */
int pc_set_wave(PCSynth *synth, const float *wave, size_t count);
/* <= 0 releases. Key changes use a 5 ms crossfade, not a pitch glide. */
void pc_set_note(PCSynth *synth, float frequency);
void pc_set_volume(PCSynth *synth, float volume); /* 0...1, output capped at 0.2. */
void pc_render(PCSynth *synth, float *output, size_t frames);
void pc_reset(PCSynth *synth); /* Render thread MUST be stopped. Preserves curve. */

#ifdef __cplusplus
}
#endif
#endif
