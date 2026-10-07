import { NOTES, excitationPosition, noteByName } from './string-model.mjs';

const enableButton = document.querySelector('#enable');
const statusEl = document.querySelector('#audio-state');
const noteSelect = document.querySelector('#note');
const freqEl = document.querySelector('#freq');
const decayInput = document.querySelector('#decay');
const decayRead = document.querySelector('#decay-read');
const stage = document.querySelector('#stage');
const canvas = document.querySelector('#string');
const hintEl = document.querySelector('#gesture-hint');
const posRead = document.querySelector('#pos-read');
const posName = document.querySelector('#pos-name');
const strRead = document.querySelector('#str-read');
const lastEl = document.querySelector('#last-pluck');
const noteA3 = document.querySelector('#note-a3');
const noteA4 = document.querySelector('#note-a4');

const STRING_START = 0.06;
const STRING_SPAN = 0.88;
const CENTER = 0.5;
const NEAR_END = 0.12;
const SOFT = 0.28;
const STRONG = 0.85;
const MIN_PULL = 0.04;

const armed = { position: CENTER, strength: 0.6 };
let selected = noteByName('A4');
let audioState = 'off';
let sounding = false;
let soundingName = '';
let dragging = false;
let pointerDown = false;
let activePointer = null;
let drag = null;
let hint = 'Drag up or down from the line, then release.';
let lastPluck = null;
let epoch = 0;
let ctx = null;
let node = null;
let targetAmp = 0;
let displayAmp = 0;
let holdQuiet = false;
let phase = 0;
let lastDraw = performance.now();

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ctx2d = canvas.getContext('2d');

for (const note of NOTES) {
  const option = document.createElement('option');
  option.value = note.name;
  option.textContent = `${note.name}  ${note.frequency.toFixed(1)} Hz`;
  if (note.name === 'A4') option.selected = true;
  noteSelect.append(option);
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

function formatPosition(position) {
  return clamp(position, 0, 1).toFixed(2);
}

function positionLabel(position) {
  const folded = Math.min(position, 1 - position);
  if (folded <= 0.2) return 'bright end';
  if (folded >= 0.4) return 'round center';
  return 'in between';
}

function decayValue() {
  return Number(decayInput.value);
}

function setHint(text) {
  hint = text;
  hintEl.textContent = text;
}

function refreshStatus() {
  let text = 'Audio off';
  if (audioState === 'starting') text = 'Starting audio…';
  else if (audioState === 'error') text = hint;
  else if (audioState === 'suspended') text = 'Audio suspended — press Enable audio';
  else if (audioState === 'on' && dragging) text = 'Holding the string — release to pluck';
  else if (audioState === 'on' && sounding) text = `Sounding ${soundingName}`;
  else if (audioState === 'on') text = `Audio on · silent · next pluck ${selected.name}`;
  statusEl.textContent = text;
  document.body.dataset.audio = audioState === 'error' ? 'error' : audioState;
  document.body.dataset.sounding = sounding ? 'yes' : 'no';
  document.body.dataset.dragging = dragging ? 'yes' : 'no';
  enableButton.textContent = audioState === 'on' ? 'Audio on' : 'Enable audio';
  enableButton.setAttribute('aria-pressed', audioState === 'on' ? 'true' : 'false');
}

function refreshArmed() {
  const position = dragging && drag ? drag.position : armed.position;
  const strength = dragging && drag ? drag.strength : armed.strength;
  const heard = excitationPosition(position);
  posRead.textContent = formatPosition(heard);
  posName.textContent = positionLabel(heard);
  strRead.textContent = strength.toFixed(2);
  const committed = !dragging;
  document.querySelector('#pos-center').setAttribute('aria-pressed', committed && armed.position === CENTER ? 'true' : 'false');
  document.querySelector('#pos-end').setAttribute('aria-pressed', committed && armed.position === NEAR_END ? 'true' : 'false');
  document.querySelector('#str-soft').setAttribute('aria-pressed', committed && armed.strength === SOFT ? 'true' : 'false');
  document.querySelector('#str-strong').setAttribute('aria-pressed', committed && armed.strength === STRONG ? 'true' : 'false');
}

function refreshDecayButtons() {
  const value = decayValue();
  decayRead.textContent = `${value.toFixed(1)} s`;
  document.querySelector('#decay-short').setAttribute('aria-pressed', value === 0.4 ? 'true' : 'false');
  document.querySelector('#decay-long').setAttribute('aria-pressed', value === 6 ? 'true' : 'false');
}

function refreshNoteButtons() {
  noteA3.setAttribute('aria-pressed', selected.name === 'A3' ? 'true' : 'false');
  noteA4.setAttribute('aria-pressed', selected.name === 'A4' ? 'true' : 'false');
  freqEl.textContent = `${selected.frequency.toFixed(1)} Hz`;
  if (noteSelect.value !== selected.name) noteSelect.value = selected.name;
}

function selectNote(name) {
  selected = noteByName(name);
  refreshNoteButtons();
  refreshStatus();
}

function post(command) {
  if (!node) return;
  epoch += 1;
  node.port.postMessage({ ...command, epoch });
}

function audioReady() {
  return ctx && ctx.state === 'running' && node && audioState === 'on';
}

async function ensureAudio() {
  if (audioState === 'starting') return;
  audioState = 'starting';
  refreshStatus();
  if (!ctx) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('This browser has no AudioContext.');
    ctx = new Context({ latencyHint: 'interactive' });
    const resumed = ctx.resume();
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'suspended' && audioState !== 'off') {
        audioState = 'suspended';
        sounding = false;
        targetAmp = 0;
        refreshStatus();
      } else if (ctx.state === 'running' && audioState === 'suspended') {
        audioState = 'on';
        refreshStatus();
      }
    });
    await ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
    await resumed;
    node = new AudioWorkletNode(ctx, 'pluck-string', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.connect(ctx.destination);
    node.port.onmessage = (event) => {
      const message = event.data;
      if (!message) return;
      if (message.type === 'error') {
        audioState = 'error';
        sounding = false;
        setHint(message.message);
        refreshStatus();
        return;
      }
      if (message.type !== 'meter' || message.epoch !== epoch) return;
      document.body.dataset.peak = message.peak.toFixed(5);
      if (holdQuiet) {
        sounding = false;
        targetAmp = 0;
        refreshStatus();
        return;
      }
      sounding = Boolean(message.active);
      targetAmp = message.active ? Math.min(1, message.rms * 7) : 0;
      refreshStatus();
    };
    node.onprocessorerror = () => {
      audioState = 'error';
      sounding = false;
      setHint('The audio processor stopped.');
      refreshStatus();
    };
  }
  if (ctx.state !== 'running') await ctx.resume();
  if (ctx.state !== 'running') {
    audioState = 'suspended';
    refreshStatus();
    return;
  }
  audioState = 'on';
  setHint('Drag up or down from the line, then release.');
  refreshStatus();
}

function pluckArmed() {
  refreshArmed();
  if (!audioReady()) {
    setHint('Press Enable audio first. The armed pluck is saved.');
    refreshStatus();
    return;
  }
  holdQuiet = false;
  const decay = decayValue();
  post({
    type: 'pluck',
    frequency: selected.frequency,
    position: armed.position,
    strength: armed.strength,
    decay,
  });
  sounding = true;
  soundingName = selected.name;
  targetAmp = Math.max(targetAmp, armed.strength * 0.45);
  lastPluck = {
    note: selected.name,
    frequency: selected.frequency,
    position: armed.position,
    strength: armed.strength,
    decay,
  };
  lastEl.textContent = `Last pluck: ${lastPluck.note} · where ${formatPosition(lastPluck.position)} (${positionLabel(lastPluck.position)}) · how hard ${lastPluck.strength.toFixed(2)} · decay ${lastPluck.decay.toFixed(1)} s`;
  setHint('Release plays the armed pluck. R repeats it.');
  refreshStatus();
}

function requestStop() {
  dragging = false;
  pointerDown = false;
  activePointer = null;
  drag = null;
  document.body.dataset.pointer = '';
  targetAmp = 0;
  displayAmp = 0;
  sounding = false;
  holdQuiet = true;
  if (node) post({ type: 'stop' });
  setHint('Stopped. The string is quiet.');
  refreshArmed();
  refreshStatus();
}

function hardQuiet(reason) {
  const wasBusy = dragging || sounding;
  if (!wasBusy && reason === 'blur') return;
  requestStop();
  if (ctx && ctx.state === 'running' && (reason === 'hidden' || reason === 'pagehide')) {
    ctx.suspend();
    audioState = 'suspended';
  }
  if (reason === 'cancel') setHint('Pluck cancelled. The string is quiet.');
  else if (reason === 'blur') setHint('The window lost focus. The string is quiet.');
  else setHint('The page moved to the background. Press Enable audio to play again.');
  refreshStatus();
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const canvasX = clamp((event.clientX - rect.left) / rect.width, STRING_START, STRING_START + STRING_SPAN);
  const along = (canvasX - STRING_START) / STRING_SPAN;
  const y = (event.clientY - rect.top) / rect.height;
  const dy = y - 0.5;
  const strength = clamp(Math.abs(dy) / 0.38, 0, 1);
  return { position: along, strength, dy, canvasX };
}

stage.addEventListener('pointerdown', (event) => {
  if (activePointer !== null) return;
  event.preventDefault();
  activePointer = event.pointerId;
  pointerDown = true;
  document.body.dataset.pointer = String(event.pointerId);
  try { stage.setPointerCapture(event.pointerId); } catch { /* still track the pointer */ }
  dragging = true;
  drag = pointerPosition(event);
  refreshArmed();
  setHint('Release to pluck. A short pull stays silent.');
  refreshStatus();
});

stage.addEventListener('pointermove', (event) => {
  if (event.pointerId !== activePointer || !drag) return;
  event.preventDefault();
  drag = pointerPosition(event);
  refreshArmed();
});

function finishPointer(event, cancelled) {
  if (!pointerDown || event.pointerId !== activePointer || !drag) return;
  const released = drag;
  pointerDown = false;
  dragging = false;
  activePointer = null;
  drag = null;
  document.body.dataset.pointer = '';
  if (cancelled) {
    hardQuiet('cancel');
    return;
  }
  if (released.strength < MIN_PULL) {
    setHint('Pull farther from the line, then release.');
    refreshArmed();
    refreshStatus();
    return;
  }
  armed.position = excitationPosition(released.position);
  armed.strength = released.strength;
  pluckArmed();
}

stage.addEventListener('pointerup', (event) => finishPointer(event, false));
stage.addEventListener('pointercancel', (event) => finishPointer(event, true));
stage.addEventListener('lostpointercapture', (event) => finishPointer(event, true));

stage.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  pluckArmed();
});

window.addEventListener('keydown', (event) => {
  const tag = event.target && event.target.tagName;
  if (event.key === 'Escape') {
    event.preventDefault();
    requestStop();
    return;
  }
  if ((event.key === 'r' || event.key === 'R') && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
    event.preventDefault();
    pluckArmed();
  }
});

window.addEventListener('blur', () => hardQuiet('blur'));
window.addEventListener('pagehide', () => hardQuiet('pagehide'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hardQuiet('hidden');
});

enableButton.addEventListener('click', () => {
  ensureAudio().catch((error) => {
    audioState = 'error';
    setHint(error && error.message ? error.message : 'Audio could not start.');
    refreshStatus();
  });
});

noteSelect.addEventListener('change', () => selectNote(noteSelect.value));
noteA3.addEventListener('click', () => selectNote('A3'));
noteA4.addEventListener('click', () => selectNote('A4'));

decayInput.addEventListener('input', () => {
  refreshDecayButtons();
  if (node && audioState === 'on') post({ type: 'decay', decay: decayValue() });
});

document.querySelector('#decay-short').addEventListener('click', () => {
  decayInput.value = '0.4';
  refreshDecayButtons();
  if (node && audioState === 'on') post({ type: 'decay', decay: 0.4 });
});

document.querySelector('#decay-long').addEventListener('click', () => {
  decayInput.value = '6';
  refreshDecayButtons();
  if (node && audioState === 'on') post({ type: 'decay', decay: 6 });
});

document.querySelector('#pos-center').addEventListener('click', () => {
  armed.position = CENTER;
  pluckArmed();
});

document.querySelector('#pos-end').addEventListener('click', () => {
  armed.position = NEAR_END;
  pluckArmed();
});

document.querySelector('#str-soft').addEventListener('click', () => {
  armed.strength = SOFT;
  pluckArmed();
});

document.querySelector('#str-strong').addEventListener('click', () => {
  armed.strength = STRONG;
  pluckArmed();
});

document.querySelector('#repeat').addEventListener('click', () => pluckArmed());
document.querySelector('#stop').addEventListener('click', () => requestStop());

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function stringShape(u, finger) {
  const pinned = Math.sin(Math.PI * u);
  const beta = Math.min(finger, 1 - finger);
  if (beta >= 0.4) return pinned;
  const center = finger < 0.5 ? 0.2 : 0.8;
  const bump = Math.exp(-((u - center) ** 2) / 0.018);
  return pinned * 0.35 + bump * 0.85;
}

function drawString(width, height, mid, pullX, pullY, amp, oscillation, shapeAt) {
  const pad = width * 0.06;
  const dpr = width / Math.max(1, canvas.getBoundingClientRect().width);
  ctx2d.beginPath();
  ctx2d.moveTo(pad, mid);
  if (pullX !== null) {
    ctx2d.lineTo(pullX, pullY);
    ctx2d.lineTo(width - pad, mid);
  } else if (amp > 0.004) {
    const steps = 48;
    for (let i = 0; i <= steps; i += 1) {
      const u = i / steps;
      const x = pad + u * (width - pad * 2);
      const y = mid + amp * height * 0.28 * oscillation * stringShape(u, shapeAt);
      ctx2d.lineTo(x, y);
    }
  } else {
    ctx2d.lineTo(width - pad, mid);
  }
  ctx2d.strokeStyle = pullX !== null ? '#fff1d4' : '#f0d7a2';
  ctx2d.lineWidth = 2.4 * (dpr || 1);
  ctx2d.lineCap = 'round';
  ctx2d.lineJoin = 'round';
  ctx2d.stroke();
}

function draw(now) {
  const dt = Math.min(0.05, (now - lastDraw) / 1000);
  lastDraw = now;
  const follow = targetAmp > displayAmp ? 0.35 : 0.42;
  displayAmp += (targetAmp - displayAmp) * follow;
  // Slow on purpose. An audio-rate wiggle aliases on a display and hides the decay.
  if (!reduceMotion && displayAmp > 0.004) phase += 7.5 * 2 * Math.PI * dt;
  resize();
  const width = canvas.width;
  const height = canvas.height;
  ctx2d.clearRect(0, 0, width, height);
  const mid = height * 0.5;
  ctx2d.strokeStyle = 'rgba(240, 215, 162, 0.18)';
  ctx2d.lineWidth = 1;
  ctx2d.beginPath();
  ctx2d.moveTo(width * 0.06, mid);
  ctx2d.lineTo(width * 0.94, mid);
  ctx2d.stroke();

  const postW = Math.max(4, width * 0.012);
  const postH = height * 0.28;
  ctx2d.fillStyle = '#c4a27a';
  ctx2d.fillRect(width * 0.05, mid - postH / 2, postW, postH);
  ctx2d.fillRect(width * 0.95 - postW, mid - postH / 2, postW, postH);

  let pullX = null;
  let pullY = null;
  if (dragging && drag) {
    pullX = drag.canvasX * width;
    pullY = mid + drag.dy * height;
  }
  const oscillation = reduceMotion ? 1 : Math.sin(phase);
  const shapeAt = lastPluck ? lastPluck.position : armed.position;
  drawString(width, height, mid, pullX, pullY, displayAmp, oscillation, shapeAt);
  requestAnimationFrame(draw);
}

refreshArmed();
refreshDecayButtons();
refreshNoteButtons();
refreshStatus();
requestAnimationFrame(draw);
