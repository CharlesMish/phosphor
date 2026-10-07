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
    test_concurrent_controls();
    return 0;
}
