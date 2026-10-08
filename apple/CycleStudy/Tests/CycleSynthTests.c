#include "CycleSynth.h"
#include <assert.h>
#include <math.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>

#define SR 48000
#define PI 3.14159265358979323846
static float buffer[SR];
static void shape(float *wave, int kind) {
    for (int i = 0; i < PC_WAVE_SIZE; ++i)
        wave[i] = kind == 0 ? (float)sin(2 * PI * i / PC_WAVE_SIZE) :
                  kind == 1 ? (i < PC_WAVE_SIZE / 2 ? 1 : -1) : 0;
}
static void settle(PCSynth *s) { pc_render(s, buffer, SR / 4); }
static double rms(const float *data, size_t n) {
    double energy = 0;
    for (size_t i = 0; i < n; ++i) energy += data[i] * data[i];
    return sqrt(energy / n);
}
static double amplitude(const float *data, size_t n, double frequency) {
    double re = 0, im = 0;
    for (size_t i = 0; i < n; ++i) {
        re += data[i] * cos(2 * PI * frequency * i / SR);
        im += data[i] * sin(2 * PI * frequency * i / SR);
    }
    return 2 * hypot(re, im) / n;
}
static void assert_bounded(const float *data, size_t n) {
    for (size_t i = 0; i < n; ++i) {
        assert(isfinite(data[i]));
        assert(fabs(data[i]) <= 0.20001);
    }
}
static void test_pitch_envelope_and_bounds(void) {
    PCSynth *s = pc_create(SR);
    assert(s);
    pc_render(s, buffer, SR);
    assert(rms(buffer, SR) == 0);
    pc_set_volume(s, 1);
    pc_set_note(s, 440);
    settle(s);
    pc_render(s, buffer, SR);
    assert_bounded(buffer, SR);
    assert(amplitude(buffer, SR, 440) > 0.199);
    assert(amplitude(buffer, SR, 441) < 0.0001);
    assert(amplitude(buffer, SR, 0) < 0.00001);
    pc_set_note(s, 0);
    pc_render(s, buffer, SR / 10);
    assert(rms(buffer + SR * 8 / 100, SR / 100) == 0);
    puts("PASS: silence, A4 pitch, DC, peak bound, release");
    pc_destroy(s);
}
static void test_wave_changes_and_band_limit(void) {
    PCSynth *s = pc_create(SR);
    float wave[PC_WAVE_SIZE];
    shape(wave, 1);
    assert(pc_set_wave(s, wave, PC_WAVE_SIZE));
    pc_reset(s);
    pc_set_volume(s, 1);
    pc_set_note(s, 6000);
    settle(s);
    pc_render(s, buffer, SR);
    // At 6 kHz, only 1 and 2 partials fit this conservative bank. A naive square
    // would have a strong 18 kHz third harmonic and aliases of higher partials.
    assert(amplitude(buffer, SR, 6000) > 0.1);
    assert(amplitude(buffer, SR, 18000) < 0.0001);
    assert_bounded(buffer, SR);
    // Replace a sounding sine with its inverse; a discontinuous switch would
    // jump by up to twice the peak. Crossfade keeps sample steps small at 220 Hz.
    shape(wave, 0);
    assert(pc_set_wave(s, wave, PC_WAVE_SIZE));
    pc_set_note(s, 220);
    settle(s);
    for (int i = 0; i < PC_WAVE_SIZE; ++i) wave[i] *= -1;
    assert(pc_set_wave(s, wave, PC_WAVE_SIZE));
    pc_render(s, buffer, SR / 10);
    for (int i = 1; i < SR / 10; ++i) assert(fabs(buffer[i] - buffer[i-1]) < 0.007);
    for (int i = 0; i < PC_WAVE_SIZE; ++i) wave[i] = 1;
    assert(pc_set_wave(s, wave, PC_WAVE_SIZE));
    settle(s);
    pc_render(s, buffer, SR / 10);
    assert(rms(buffer, SR / 10) < 0.00001);
    puts("PASS: conservative harmonic filtering, waveform crossfade, constant curve silence");
    pc_destroy(s);
}
static void test_queue_and_invalid_controls(void) {
    PCSynth *s = pc_create(SR);
    float wave[PC_WAVE_SIZE];
    shape(wave, 1);
    assert(!pc_set_wave(s, wave, PC_WAVE_SIZE - 1));
    assert(!pc_set_wave(s, NULL, PC_WAVE_SIZE));
    assert(pc_set_wave(s, wave, PC_WAVE_SIZE));
    assert(pc_set_wave(s, wave, PC_WAVE_SIZE));
    shape(wave, 2);
    assert(pc_set_wave(s, wave, PC_WAVE_SIZE));
    assert(!pc_set_wave(s, wave, PC_WAVE_SIZE));
    pc_reset(s); // Consumes the latest (silent) edit, not the oldest square.
    pc_set_note(s, 440);
    settle(s);
    assert(rms(buffer, SR / 4) == 0);
    for (int i = 0; i < PC_WAVE_SIZE; ++i) wave[i] = i % 2 ? NAN : INFINITY;
    assert(pc_set_wave(s, wave, PC_WAVE_SIZE));
    pc_set_volume(s, INFINITY);
    pc_set_note(s, NAN);
    pc_render(s, buffer, SR);
    assert_bounded(buffer, SR);
    assert(rms(buffer + SR / 2, SR / 2) == 0);
    assert(!pc_create(0));
    assert(!pc_create(NAN));
    pc_destroy(s);
    puts("PASS: full queue, latest edit, invalid inputs, reset");
}

static void test_key_change_continuity(void) {
    PCSynth *changed = pc_create(SR), *reference = pc_create(SR);
    assert(changed && reference);
    float wave[PC_WAVE_SIZE], expected[1];
    // The 64th harmonic fits the 300 Hz bank but not the 400 Hz bank. The old
    // implementation dropped it at the next callback, creating an abrupt step.
    for (int i = 0; i < PC_WAVE_SIZE; ++i)
        wave[i] = (float)sin(2 * PI * 64 * i / PC_WAVE_SIZE);
    assert(pc_set_wave(changed, wave, PC_WAVE_SIZE));
    assert(pc_set_wave(reference, wave, PC_WAVE_SIZE));
    pc_reset(changed);
    pc_reset(reference);
    pc_set_volume(changed, 1);
    pc_set_volume(reference, 1);
    pc_set_note(changed, 300);
    pc_set_note(reference, 300);
    pc_render(changed, buffer, 12001);
    pc_render(reference, buffer, 12001);
    pc_render(reference, expected, 1);
    assert(fabs(expected[0]) > 0.1); // Ensure this actually observes a bank edge.
    pc_set_note(changed, 400);
    pc_render(changed, buffer, SR / 100);
    assert(fabs(buffer[0] - expected[0]) < 0.000001);
    assert_bounded(buffer, SR / 100);
    assert(rms(buffer + SR * 6 / 1000, SR * 4 / 1000) < 0.00001);
    pc_destroy(changed);
    pc_destroy(reference);
    puts("PASS: key change preserves continuity and finishes at the new harmonic bank");
}

static void test_rapid_keys_and_sample_rates(void) {
    const double rates[] = {8000, 44100, 48000, 96000, 192000};
    float wave[PC_WAVE_SIZE], samples[13];
    shape(wave, 1);
    for (size_t rate = 0; rate < sizeof(rates) / sizeof(rates[0]); ++rate) {
        PCSynth *s = pc_create(rates[rate]);
        assert(s);
        assert(pc_set_wave(s, wave, PC_WAVE_SIZE));
        pc_reset(s);
        pc_set_volume(s, 1);
        pc_set_note(s, 220);
        pc_render(s, buffer, SR / 4);
        // Re-key much faster than a tail can finish, including both harmonic
        // ceilings and the frequency clamp. An unfinished tail must not grow.
        for (unsigned key = 0; key < 150; ++key) {
            pc_set_note(s, key % 2 ? 220 : 20000);
            pc_render(s, samples, 13);
            assert_bounded(samples, 13);
        }
        pc_set_note(s, 0);
        pc_render(s, buffer, SR / 2);
        assert(rms(buffer + SR / 4, SR / 4) == 0);
        pc_set_note(s, 440);
        pc_render(s, samples, 13);
        pc_set_note(s, 880);
        pc_render(s, samples, 1);
        pc_reset(s);
        pc_render(s, samples, 13);
        assert(rms(samples, 13) == 0); // Reset also clears a saved transition.
        pc_destroy(s);
    }
    puts("PASS: rapid re-keying, release and reset at 8–192 kHz stay bounded");
}
typedef struct { PCSynth *s; atomic_bool done; } Stress;
static void *render_thread(void *arg) {
    Stress *stress = arg;
    float samples[127];
    do {
        pc_render(stress->s, samples, 127);
        assert_bounded(samples, 127);
    } while (!atomic_load(&stress->done));
    return NULL;
}
static void test_concurrent_controls(void) {
    Stress stress = { .s = pc_create(SR) };
    atomic_init(&stress.done, 0);
    pthread_t thread;
    assert(!pthread_create(&thread, NULL, render_thread, &stress));
    float wave[PC_WAVE_SIZE];
    for (int i = 0; i < 80; ++i) {
        shape(wave, i % 3);
        while (!pc_set_wave(stress.s, wave, PC_WAVE_SIZE)) { /* producer retry */ }
        pc_set_note(stress.s, i % 7 ? 100 + i * 71 : 0);
        pc_set_volume(stress.s, (i % 11) / 10.0f);
    }
    atomic_store(&stress.done, 1);
    assert(!pthread_join(thread, NULL));
    pc_destroy(stress.s);
    puts("PASS: concurrent producer / audio consumer");
}
int main(void) {
    test_pitch_envelope_and_bounds();
    test_wave_changes_and_band_limit();
    test_queue_and_invalid_controls();
    test_key_change_continuity();
    test_rapid_keys_and_sample_rates();
    test_concurrent_controls();
    return 0;
}
