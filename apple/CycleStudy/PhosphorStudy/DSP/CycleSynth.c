#include "CycleSynth.h"
#include <math.h>
#include <stdint.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

#define TABLE_SIZE 1024
#define LEVELS 7
#define QUEUE_SIZE 4
#define MAX_PITCH_TAIL 960 /* 5 ms at the maximum supported 192 kHz. */
#define PI 3.14159265358979323846
_Static_assert(ATOMIC_INT_LOCK_FREE == 2, "Audio controls require lock-free atomics");

typedef struct { float table[LEVELS][TABLE_SIZE]; } WaveBank;
struct PCSynth {
    double sample_rate, phase;
    float envelope, volume, frequency, blend;
    float pitch_tail[MAX_PITCH_TAIL];
    size_t pitch_tail_count, pitch_tail_index;
    WaveBank from, to, queue[QUEUE_SIZE];
    _Atomic unsigned head, tail;
    _Atomic unsigned note_bits, volume_bits;
};

static unsigned bits(float value) {
    unsigned result;
    _Static_assert(sizeof(result) == sizeof(value), "32-bit float required");
    memcpy(&result, &value, sizeof(result));
    return result;
}
static float unbits(unsigned value) {
    float result;
    memcpy(&result, &value, sizeof(result));
    return result;
}
static float bounded(float value, float low, float high) {
    if (!isfinite(value)) return low;
    return fminf(high, fmaxf(low, value));
}

/* Control thread only. 64 Fourier partials, no DC. Each level has a harmonic
   ceiling 1,2,4,8,16,32,64; render chooses one below 0.45 * sample rate.
   This intentionally differs from browser Phosphor's 512-sample PeriodicWave. */
static void make_bank(WaveBank *bank, const float *wave) {
    double real[65] = {0}, sine[65] = {0};
    for (unsigned k = 1; k <= 64; ++k) {
        for (unsigned i = 0; i < PC_WAVE_SIZE; ++i) {
            double angle = 2.0 * PI * k * i / PC_WAVE_SIZE;
            double value = bounded(wave[i], -1, 1);
            real[k] += value * cos(angle) * (2.0 / PC_WAVE_SIZE);
            sine[k] += value * sin(angle) * (2.0 / PC_WAVE_SIZE);
        }
    }
    double peak = 1.0; /* Never amplify quiet drawings. */
    for (unsigned i = 0; i < TABLE_SIZE; ++i) {
        double value = 0;
        unsigned level = 0;
        for (unsigned k = 1; k <= 64; ++k) {
            double angle = 2.0 * PI * k * i / TABLE_SIZE;
            value += real[k] * cos(angle) + sine[k] * sin(angle);
            if (k == (1u << level)) {
                bank->table[level++][i] = (float)value;
                peak = fmax(peak, fabs(value));
            }
        }
    }
    for (unsigned l = 0; l < LEVELS; ++l)
        for (unsigned i = 0; i < TABLE_SIZE; ++i)
            bank->table[l][i] /= (float)peak;
}

PCSynth *pc_create(double sample_rate) {
    if (!isfinite(sample_rate) || sample_rate < 8000 || sample_rate > 192000) return NULL;
    PCSynth *s = calloc(1, sizeof(*s));
    if (!s) return NULL;
    s->sample_rate = sample_rate;
    s->frequency = 261.625565f;
    s->blend = 1;
    s->volume = 0.3f;
    atomic_init(&s->head, 0);
    atomic_init(&s->tail, 0);
    atomic_init(&s->note_bits, bits(0));
    atomic_init(&s->volume_bits, bits(0.3f));
    float sine[PC_WAVE_SIZE];
    for (unsigned i = 0; i < PC_WAVE_SIZE; ++i)
        sine[i] = (float)sin(2 * PI * i / PC_WAVE_SIZE);
    make_bank(&s->to, sine);
    s->from = s->to;
    return s;
}

void pc_destroy(PCSynth *s) { free(s); }

int pc_set_wave(PCSynth *s, const float *wave, size_t count) {
    if (!s || !wave || count != PC_WAVE_SIZE) return 0;
    unsigned head = atomic_load_explicit(&s->head, memory_order_relaxed);
    unsigned tail = atomic_load_explicit(&s->tail, memory_order_acquire);
    unsigned next = (head + 1) % QUEUE_SIZE;
    if (next == tail) return 0; /* Caller retries latest edit; never block render. */
    make_bank(&s->queue[head], wave);
    atomic_store_explicit(&s->head, next, memory_order_release);
    return 1;
}

void pc_set_note(PCSynth *s, float frequency) {
    if (!s) return;
    float note = !isfinite(frequency) || frequency < 20 ? 0 :
        fminf(frequency, (float)(s->sample_rate * 0.2));
    atomic_store_explicit(&s->note_bits, bits(note), memory_order_relaxed);
}
void pc_set_volume(PCSynth *s, float volume) {
    if (s) atomic_store_explicit(&s->volume_bits, bits(bounded(volume, 0, 1)), memory_order_relaxed);
}

static void take_latest_wave(PCSynth *s) {
    unsigned head = atomic_load_explicit(&s->head, memory_order_acquire);
    unsigned tail = atomic_load_explicit(&s->tail, memory_order_relaxed);
    if (head == tail) return;
    for (unsigned l = 0; l < LEVELS; ++l)
        for (unsigned i = 0; i < TABLE_SIZE; ++i)
            s->from.table[l][i] += s->blend * (s->to.table[l][i] - s->from.table[l][i]);
    s->to = s->queue[(head + QUEUE_SIZE - 1) % QUEUE_SIZE];
    s->blend = 0;
    atomic_store_explicit(&s->tail, head, memory_order_release);
}

typedef struct {
    unsigned level;
    double step;
    float attack, release, blend_step, volume_step;
} RenderSettings;

static RenderSettings render_settings(const PCSynth *s) {
    unsigned level = 0;
    while (level + 1 < LEVELS && (1u << (level + 1)) * s->frequency < s->sample_rate * 0.45)
        ++level;
    return (RenderSettings) {
        level, s->frequency / s->sample_rate,
        (float)(1.0 / (s->sample_rate * 0.012)),
        (float)(1.0 / (s->sample_rate * 0.060)),
        (float)(1.0 / (s->sample_rate * 0.025)),
        (float)(1.0 - exp(-1.0 / (s->sample_rate * 0.010)))
    };
}

static float render_sample(PCSynth *s, const RenderSettings *r, int held, float target_volume) {
    s->envelope = held ? fminf(1, s->envelope + r->attack) : fmaxf(0, s->envelope - r->release);
    s->volume += r->volume_step * (target_volume - s->volume);
    double at = s->phase * TABLE_SIZE;
    unsigned i0 = (unsigned)at % TABLE_SIZE, i1 = (i0 + 1) % TABLE_SIZE;
    float u = (float)(at - floor(at));
    float old = s->from.table[r->level][i0] + u * (s->from.table[r->level][i1] - s->from.table[r->level][i0]);
    float next = s->to.table[r->level][i0] + u * (s->to.table[r->level][i1] - s->to.table[r->level][i0]);
    float output = (old + s->blend * (next - old)) * s->envelope * s->volume * 0.2f;
    s->blend = fminf(1, s->blend + r->blend_step);
    s->phase += r->step;
    s->phase -= floor(s->phase);
    if (s->pitch_tail_index < s->pitch_tail_count) {
        float mix = (float)s->pitch_tail_index / (float)s->pitch_tail_count;
        float tail = s->pitch_tail[s->pitch_tail_index++];
        output = tail + mix * (output - tail);
    }
    return output;
}

/* Preserve a short continuation of the previous pitch, including any unfinished
   pitch crossfade. Each voice uses its own harmonic ceiling: changing keys does
   not retune an old high-harmonic table into the new pitch. Fixed storage and a
   maximum 960-frame loop keep the callback bounded; no allocation or locks. */
static void capture_pitch_tail(PCSynth *s, float target_volume) {
    double phase = s->phase;
    float envelope = s->envelope, volume = s->volume, blend = s->blend;
    RenderSettings r = render_settings(s);
    size_t count = (size_t)(s->sample_rate * 0.005);
    if (count > MAX_PITCH_TAIL) count = MAX_PITCH_TAIL;
    /* Existing tail reads are at or ahead of the write index, so capturing in
       place is safe even when notes change faster than the 5 ms transition. */
    for (size_t i = 0; i < count; ++i)
        s->pitch_tail[i] = render_sample(s, &r, 1, target_volume);
    s->phase = phase;
    s->envelope = envelope;
    s->volume = volume;
    s->blend = blend;
    s->pitch_tail_index = 0;
    s->pitch_tail_count = count;
}

void pc_render(PCSynth *s, float *output, size_t frames) {
    if (!output) return;
    if (!s) { memset(output, 0, frames * sizeof(float)); return; }
    take_latest_wave(s);
    float note = unbits(atomic_load_explicit(&s->note_bits, memory_order_relaxed));
    float target_volume = unbits(atomic_load_explicit(&s->volume_bits, memory_order_relaxed));
    if (note > 0 && note != s->frequency) {
        if (s->envelope > 0) capture_pitch_tail(s, target_volume);
        s->frequency = note;
    }
    RenderSettings r = render_settings(s);
    for (size_t frame = 0; frame < frames; ++frame)
        output[frame] = render_sample(s, &r, note > 0, target_volume);
}

void pc_reset(PCSynth *s) {
    if (!s) return;
    take_latest_wave(s);
    s->from = s->to;
    s->blend = 1;
    s->phase = 0;
    s->envelope = 0;
    s->pitch_tail_count = s->pitch_tail_index = 0;
    pc_set_note(s, 0);
}
