import { AudioHost } from './shared/audio-host.mjs';
import * as catchView from './experiments/catch/view.mjs';
import * as slideView from './experiments/slide/view.mjs';
import * as bowView from './experiments/bow/view.mjs';
import * as resonantView from './experiments/resonant/view.mjs';
import * as ribbonView from './experiments/ribbon/view.mjs';

const experiments = {
  ribbon: { module: ribbonView, title: 'Bowed Slide', label: 'EXPERIMENT 05 / BOW & GLIDE', description: 'Give a moving note a continuous breath.', hint: 'Hold and stroke up–down to bow. Travel left–right to change pitch.', question: 'Keep one note alive with vertical strokes. Glide to another, then rock sideways for a little vibrato.' },
  catch: { module: catchView, title: 'Catch', label: 'EXPERIMENT 01 / DAMP & RELEASE', description: 'Pluck a note, then decide how long it gets to live.', hint: 'Pull the string and release. Touch the strip below to catch its tail.', question: 'Make one note ring, catch the next one early, then find a muted rhythm.' },
  slide: { module: slideView, title: 'Slide', label: 'EXPERIMENT 02 / BEND & GLIDE', description: 'Let one note travel. Give it somewhere to go.', hint: 'Touch the ribbon to pluck. Move sideways for pitch, vertically for the tail.', question: 'Find two notes you like. Slide between them, then linger with a little vibrato.' },
  bow: { module: bowView, title: 'Bow', label: 'EXPERIMENT 03 / MOVE & SUSTAIN', description: 'Your movement keeps the string alive.', hint: 'Rub back and forth. Move higher or lower to change the texture.', question: 'Begin gently, build the sound, then let stillness bring it to an end.' },
  resonant: { module: resonantView, title: 'Resonant Ends', label: 'EXPERIMENT 04 / PLACE & TRANSFORM', description: 'One surface. Three very different characters.', hint: 'Pluck in a different region. Use the body strip to reshape the ringing sound.', question: 'Compare wood, open string, and metal. Can you get back to your favorite sound?' },
};

const $ = (selector) => document.querySelector(selector);
const container = $('#experiment-view');
const audioButton = $('#enable-audio');
const demoButton = $('#show-demo');
const hintElement = $('#performance-hint');
const stateElement = $('#audio-state');
const bars = [...document.querySelectorAll('.level-meter i')];
let currentId = null;
let view = null;
let modeEpoch = 0;
let demoEpoch = 0;
let demoFrameId = null;
let runningDemo = false;
let transitioning = false;
let meter = { rms: 0, peak: 0, active: false };
let host;

function hint(text) { hintElement.textContent = text; }

function setMeter(next) {
  meter = next;
  const height = Math.min(1, Math.sqrt(Math.max(0, next.rms || 0)) * 3);
  bars.forEach((bar, i) => {
    bar.style.height = `${4 + height * (i === 2 ? 18 : i % 2 ? 13 : 8)}px`;
    bar.style.background = next.active ? 'var(--accent)' : 'var(--line)';
  });
  document.body.dataset.sounding = next.active ? 'yes' : 'no';
}

function setState(state) {
  const labels = { off: 'Audio off', starting: 'Starting…', on: 'Audio ready', suspended: 'Audio paused', error: 'Audio needs a retry' };
  stateElement.textContent = labels[state] || state;
  audioButton.dataset.on = String(state === 'on');
  audioButton.innerHTML = state === 'on' ? '<span aria-hidden="true">◖</span> Audio on' : state === 'starting' ? 'Starting…' : '<span aria-hidden="true">◖</span> Enable audio';
  audioButton.disabled = state === 'starting';
  document.body.dataset.audio = state;
  if (host && ['suspended', 'error', 'off'].includes(state)) {
    cancelDemo(false);
    view?.cancel?.();
  }
  if (state !== 'on') setMeter({ rms: 0, peak: 0, active: false });
}

host = new AudioHost({ onState: setState, onMeter: setMeter, onError: error => hint(`Audio could not start. Try Enable audio again. ${error.message || ''}`) });

function cancelDemo(quiet = true) {
  demoEpoch += 1;
  if (demoFrameId !== null) cancelAnimationFrame(demoFrameId);
  demoFrameId = null;
  const wasRunning = runningDemo;
  runningDemo = false;
  demoButton.setAttribute('aria-pressed', 'false');
  demoButton.innerHTML = '<span aria-hidden="true">▷</span> Show me';
  $('#demo-progress').style.width = '0%';
  if (wasRunning) {
    view?.demoFrame?.(null);
    if (quiet) host.stop();
  }
}

function stop(message = 'Stopped. Your next gesture starts fresh.') {
  cancelDemo(false);
  view?.cancel?.();
  host.stop();
  setMeter({ rms: 0, peak: 0, active: false });
  hint(message);
}

async function select(id, updateHash = true) {
  if (!Object.hasOwn(experiments, id)) id = 'ribbon';
  if (id === currentId) return;
  const epoch = ++modeEpoch;
  transitioning = true;
  stop();
  view?.dispose?.();
  view = null;
  container.replaceChildren();
  currentId = id;
  const experiment = experiments[id];
  $('#instrument').dataset.mode = id;
  document.querySelectorAll('[data-mode].experiment-card').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === id)));
  $('#experiment-title').textContent = experiment.title;
  $('#experiment-label').textContent = experiment.label;
  $('#experiment-description').textContent = experiment.description;
  $('#listening-question').textContent = experiment.question;
  if (updateHash) history.replaceState(null, '', `#${id}`);
  view = experiment.module.mount(container, {
    ready: () => Boolean(host.ready && !transitioning),
    send(command) {
      if (!host.ready || transitioning) { hint('Enable audio first, then try that gesture.'); return false; }
      return host.send(command);
    },
    interact() { cancelDemo(true); },
    hint,
    meter: () => meter,
  });
  hint(host.ready ? experiment.hint : `Enable audio, then try ${experiment.title.toLowerCase()}.`);
  try { await host.select(id); }
  catch (error) { hint(`Could not open this instrument: ${error.message}. Try Enable audio.`); }
  finally { if (epoch === modeEpoch) transitioning = false; }
}

audioButton.addEventListener('click', async () => {
  try { await host.enable(); if (host.ready) hint(experiments[currentId].hint); }
  catch (error) { hint(`Audio could not start. Try Enable audio again. ${error.message || ''}`); }
});

demoButton.addEventListener('click', async () => {
  if (runningDemo) { stop('Demo stopped. Try it with your own hands.'); return; }
  stop();
  const requestedMode = currentId;
  const requestEpoch = demoEpoch;
  try { await host.enable(); } catch { return; }
  if (!host.ready || transitioning || requestedMode !== currentId || requestEpoch !== demoEpoch) return;
  host.send({ type: 'reset' });
  view.reset();
  const timeline = experiments[currentId].module.demo;
  const start = performance.now();
  let next = 0;
  runningDemo = true;
  demoButton.setAttribute('aria-pressed', 'true');
  demoButton.innerHTML = '<span aria-hidden="true">□</span> Stop demo';
  const play = (now) => {
    if (!runningDemo || requestEpoch !== demoEpoch || requestedMode !== currentId) return;
    const elapsed = (now - start) / 1000;
    while (next < timeline.events.length && timeline.events[next].at <= elapsed) {
      const event = timeline.events[next++];
      if (event.command) host.send(event.command);
      if (event.visual !== undefined) view.demoFrame(event.visual);
      if (event.hint) hint(event.hint);
    }
    $('#demo-progress').style.width = `${Math.min(100, elapsed / timeline.duration * 100)}%`;
    if (elapsed >= timeline.duration) {
      cancelDemo(false);
      hint('Your turn. Try that gesture, then change something.');
      return;
    }
    demoFrameId = requestAnimationFrame(play);
  };
  demoFrameId = requestAnimationFrame(play);
});

$('#stop-audio').addEventListener('click', () => stop());
$('#reset-experiment').addEventListener('click', () => {
  stop();
  host.send({ type: 'reset' });
  view?.reset?.();
  hint(experiments[currentId].hint);
});
document.querySelectorAll('.experiment-card').forEach(button => button.addEventListener('click', () => select(button.dataset.mode)));
window.addEventListener('hashchange', () => select(location.hash.slice(1), false));
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); stop(); }
});
function pause() {
  stop('Audio paused. Enable audio when you return.');
  Promise.resolve(host.suspend()).catch(error => hint(error.message));
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('pagehide', pause);
window.addEventListener('blur', () => stop('Paused when the window lost focus. Play again when you’re ready.'));

setState('off');
select(location.hash.slice(1) || 'ribbon', false);
