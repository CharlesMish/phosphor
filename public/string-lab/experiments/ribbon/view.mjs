const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const landmarks = new Map([[57, 'A3'], [59, 'B'], [60, 'C4'], [62, 'D'], [64, 'E'], [65, 'F'], [67, 'G'], [69, 'A4']]);
// A continuous attraction, not quantization: note centers are easier to hold,
// while a small sideways bend still changes the pitch.
const attractedPitch = midi => midi - .85 * Math.sin(2 * Math.PI * midi) / (2 * Math.PI);
const describePitch = midi => {
  const nearest = Math.round(midi);
  const cents = Math.round((midi - nearest) * 100);
  return `${names[nearest % 12]}${Math.floor(nearest / 12) - 1}${cents ? ` ${cents > 0 ? '+' : ''}${cents}¢` : ''}`;
};

export function mount(container, api) {
  container.innerHTML = `
    <style>
      #ribbon-experiment .ribbon-intro{max-width:64ch;margin:0 0 17px;line-height:1.6;font-size:14px}
      #ribbon-surface{height:340px;min-height:300px;cursor:crosshair;touch-action:none;background:#f5f2e9;border-color:rgba(var(--accent-rgb),.26)}
      #ribbon-surface:focus-visible{outline:3px solid var(--accent);outline-offset:4px}
      #ribbon-experiment .ribbon-axis{position:absolute;left:19px;right:19px;display:flex;justify-content:space-between;gap:10px;font-size:10px;letter-spacing:.1em;pointer-events:none;color:var(--accent)}
      #ribbon-experiment .ribbon-axis.top{top:15px}#ribbon-experiment .ribbon-axis.bottom{bottom:15px;justify-content:center;font-size:9px;letter-spacing:.12em}
      #ribbon-experiment .ribbon-fret{position:absolute;top:46px;bottom:44px;width:1px;background:rgba(var(--accent-rgb),.10);pointer-events:none}
      #ribbon-experiment .ribbon-fret.natural{background:rgba(var(--accent-rgb),.17)}
      #ribbon-experiment .ribbon-fret span{position:absolute;top:4px;left:6px;font-size:10px;font-weight:550;color:var(--accent);white-space:nowrap}
      #ribbon-experiment .ribbon-fret.end span{left:auto;right:5px}
      #ribbon-experiment .ribbon-lane{position:absolute;top:46px;bottom:44px;width:39px;transform:translateX(-50%);border-radius:20px;background:rgba(var(--accent-rgb),.06);pointer-events:none}
      #ribbon-experiment svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
      #ribbon-experiment .ribbon-pin{position:absolute;width:30px;height:30px;transform:translate(-50%,-50%);border-radius:50%;border:1.5px solid var(--accent);background:#fcfaf5;box-shadow:0 0 0 6px rgba(var(--accent-rgb),.07);pointer-events:none;opacity:.6}
      #ribbon-experiment .ribbon-pin:after{content:'';position:absolute;inset:10px;background:var(--accent);border-radius:50%}
      #ribbon-experiment .ribbon-pin.active{opacity:1;box-shadow:0 0 0 9px rgba(var(--accent-rgb),.10)}
      #ribbon-experiment .ribbon-pin:before{content:'↕';position:absolute;left:5px;top:-42px;font-size:27px;color:var(--accent);opacity:.6}
      #ribbon-experiment .ribbon-invitation{position:absolute;left:10px;right:10px;bottom:58px;text-align:center;pointer-events:none}
      #ribbon-experiment .ribbon-invitation span{display:inline-block;background:#fcfaf5ed;border:1px solid #e6e2d6;border-radius:20px;padding:6px 12px;font-size:12px;color:#646d70}
      #ribbon-experiment .ribbon-feedback{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-top:17px}
      #ribbon-experiment .ribbon-pitch{color:var(--accent);font-size:16px;min-width:100px;font-variant-numeric:tabular-nums}
      #ribbon-experiment .ribbon-energy{display:flex;align-items:center;gap:9px;font-size:12px;color:var(--muted)}
      #ribbon-experiment .ribbon-track{display:inline-block;width:100px;height:6px;overflow:hidden;border-radius:8px;background:#dcdcd2}
      #ribbon-experiment .ribbon-fill{display:block;height:100%;width:0;background:var(--accent);border-radius:8px}
      #ribbon-experiment .ribbon-state{min-width:68px;text-align:right;font-size:12px;color:var(--muted)}
      #ribbon-experiment .ribbon-settings{display:flex;gap:8px 22px;align-items:center;flex-wrap:wrap;margin-top:14px;padding-top:10px;border-top:1px solid #e5e2d8}
      #ribbon-experiment .ribbon-snap{display:flex;align-items:center;gap:9px;min-height:44px;cursor:pointer;font-size:13px}
      #ribbon-experiment .ribbon-snap input{height:18px;width:18px;accent-color:var(--accent)}
      #ribbon-experiment .ribbon-snap-help{font-size:12px;color:var(--muted)}
      #ribbon-experiment .ribbon-help{font-size:12px;line-height:1.65;margin-top:10px}
      @media(max-width:600px){#ribbon-surface{height:310px}#ribbon-experiment .ribbon-intro{font-size:13px}#ribbon-experiment .ribbon-axis{left:12px;right:12px;font-size:9px}#ribbon-experiment .ribbon-fret span{font-size:9px;left:3px}#ribbon-experiment .ribbon-track{width:74px}#ribbon-experiment .ribbon-state{min-width:55px;font-size:11px}#ribbon-experiment .ribbon-pitch{min-width:82px;font-size:14px}#ribbon-experiment .ribbon-energy{font-size:11px;gap:6px}#ribbon-experiment .ribbon-feedback{gap:9px}#ribbon-experiment .ribbon-settings{gap:0}#ribbon-experiment .ribbon-snap-help{flex-basis:100%;margin-top:-3px}#ribbon-experiment .ribbon-invitation span{font-size:11px;padding:6px 9px}}
    </style>
    <section id="ribbon-experiment">
      <p class="ribbon-intro">Bow up and down to keep the sound alive. Glide sideways for pitch; add a small sideways wobble for vibrato.</p>
      <div id="ribbon-surface" class="play-surface" tabindex="0" role="slider" aria-label="Bowed Slide pitch and bowing surface" aria-orientation="horizontal" aria-valuemin="57" aria-valuemax="69" aria-valuenow="62" aria-valuetext="D4" aria-describedby="ribbon-keyboard">
        <div class="ribbon-axis top"><span>LOW</span><span>← PITCH →</span><span>HIGH</span></div>
        ${Array.from({length:13}, (_, i) => {const midi = i + 57; return `<div class="ribbon-fret ${landmarks.has(midi) ? 'natural' : ''} ${i === 12 ? 'end' : ''}" style="left:${5 + i * 7.5}%">${landmarks.has(midi) ? `<span>${landmarks.get(midi)}</span>` : ''}</div>`;}).join('')}
        <div id="ribbon-lane" class="ribbon-lane"></div>
        <svg viewBox="0 0 1000 340" preserveAspectRatio="none" aria-hidden="true"><path d="M50 170H950" fill="none" stroke="#bdc4c1" stroke-width="1"/><path id="ribbon-string" d="M50 170H950" fill="none" stroke="var(--accent)" stroke-width="1.7"/><circle cx="50" cy="170" r="3" fill="var(--accent)"/><circle cx="950" cy="170" r="3" fill="var(--accent)"/></svg>
        <div id="ribbon-pin" class="ribbon-pin"></div>
        <div id="ribbon-invitation" class="ribbon-invitation"><span>Touch, then stroke up & down</span></div>
        <div class="ribbon-axis bottom"><span>↕ MOVEMENT FEEDS THE STRING</span></div>
      </div>
      <div class="ribbon-feedback">
        <output id="ribbon-pitch" class="ribbon-pitch">D4</output>
        <div class="ribbon-energy"><span>Bow energy</span><span id="ribbon-energy" class="ribbon-track" role="meter" aria-label="Bow movement energy" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="ribbon-energy-fill" class="ribbon-fill"></i></span></div>
        <output id="ribbon-state" class="ribbon-state">At rest</output>
      </div>
      <div class="ribbon-settings">
        <label class="ribbon-snap"><input id="ribbon-snap" type="checkbox" checked aria-describedby="ribbon-snap-help">Land on notes</label>
        <span id="ribbon-snap-help" class="ribbon-snap-help">Gently attracts to notes while keeping bends.</span>
      </div>
      <p id="ribbon-keyboard" class="ribbon-help muted">Keyboard: focus the surface, hold ↑ or ↓ to bow, and hold ← / → to glide.<br>Lift or hold still to let the tone fade. Height alone adds no effect.</p>
    </section>`;

  const surface = container.querySelector('#ribbon-surface');
  const snap = container.querySelector('#ribbon-snap');
  const pin = container.querySelector('#ribbon-pin');
  const lane = container.querySelector('#ribbon-lane');
  const string = container.querySelector('#ribbon-string');
  const pitchReadout = container.querySelector('#ribbon-pitch');
  const energyMeter = container.querySelector('#ribbon-energy');
  const energyFill = container.querySelector('#ribbon-energy-fill');
  const stateReadout = container.querySelector('#ribbon-state');
  const invitation = container.querySelector('#ribbon-invitation');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const listeners = [];
  const held = new Set();
  const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  let rawMidi = 62, y = .5, pointer = null, filteredSpeed = 0;
  let lastY = .5, lastMove = -Infinity, lastTime = 0, lastSend = -Infinity;
  let previousFrame = 0, frame = 0, disposed = false, demoVisual = null;

  const pitch = () => snap.checked ? attractedPitch(rawMidi) : rawMidi;
  const keyboardBow = () => held.has('ArrowUp') || held.has('ArrowDown');
  const on = (target, name, handler) => {
    target.addEventListener(name, handler);
    listeners.push(() => target.removeEventListener(name, handler));
  };
  const point = event => {
    const rect = surface.getBoundingClientRect();
    return {
      midi:57 + clamp(((event.clientX - rect.left) / rect.width - .05) / .9) * 12,
      y:clamp((event.clientY - rect.top) / rect.height),
    };
  };
  const send = (speed, active) => api.send({type:'bow', active, speed, midi:pitch()});
  const velocityAt = now => pointer !== null && now - lastMove < 130 ? filteredSpeed * Math.exp(-(now - lastMove) / 75) : 0;
  const releasePointer = () => {
    const old = pointer; pointer = null; filteredSpeed = 0; lastMove = -Infinity;
    if(old !== null && surface.hasPointerCapture(old)) surface.releasePointerCapture(old);
  };
  const cancel = () => {
    releasePointer(); held.clear(); demoVisual = null;
  };
  const start = () => {
    api.interact(); demoVisual = null;
    if(api.ready()) return true;
    api.hint('Enable audio, then stroke up and down on the surface.');
    return false;
  };
  const finish = event => {
    if(pointer === null || event.pointerId !== pointer) return;
    releasePointer(); send(0, false);
    api.hint('Lifted away. The remaining tone fades naturally.');
  };

  on(surface, 'pointerdown', event => {
    if(pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if(!start()) return;
    event.preventDefault(); held.clear(); surface.focus({preventScroll:true});
    const at = point(event); rawMidi = at.midi; y = at.y;
    pointer = event.pointerId; lastY = y; lastTime = performance.now(); lastMove = -Infinity; filteredSpeed = 0;
    surface.setPointerCapture(pointer); send(0, true); lastSend = lastTime;
    api.hint('Up and down keeps the tone alive. Sideways changes its pitch.');
  });
  on(surface, 'pointermove', event => {
    if(event.pointerId !== pointer) return;
    event.preventDefault();
    const now = performance.now(), at = point(event);
    const dt = Math.max(.008, Math.min(.16, (now - lastTime) / 1000));
    // Only travel on the vertical axis supplies energy. Pure pitch movement
    // cannot start a silent string, and position at the top/bottom is neutral.
    const verticalSpeed = clamp(Math.abs(at.y - lastY) / dt * 1.35);
    filteredSpeed = velocityAt(now) * .3 + verticalSpeed * .7;
    rawMidi = at.midi; y = at.y; lastY = y; lastTime = now; lastMove = now;
    if(now - lastSend >= 16) {send(filteredSpeed, true); lastSend = now;}
  });
  on(surface, 'pointerup', finish);
  on(surface, 'pointercancel', finish);
  on(surface, 'lostpointercapture', finish);
  on(surface, 'keydown', event => {
    if(!arrows.includes(event.key)) return;
    event.preventDefault();
    // Frames sustain held keys. A repeat after Stop/cancel must not resurrect
    // a key that is physically down but no longer belongs to this gesture.
    if(event.repeat) return;
    if(!start()) return;
    if(!api.ready()) return;
    // Keyboard and pointer have one clear owner; neither can leave a hidden
    // bow held underneath the other input method.
    if(pointer !== null) releasePointer();
    held.add(event.key);
    send(keyboardBow() ? .58 : 0, true); lastSend = performance.now();
    api.hint('Hold ↑ or ↓ for a steady bow; ← / → glides the pitch.');
  });
  on(surface, 'keyup', event => {
    if(!held.has(event.key)) return;
    event.preventDefault(); held.delete(event.key);
    send(keyboardBow() ? .58 : 0, held.size > 0);
  });
  on(surface, 'blur', () => {
    if(pointer !== null || held.size) {cancel(); send(0, false);}
  });
  on(snap, 'change', () => {
    api.interact(); demoVisual = null;
    send(0, false);
    api.hint(snap.checked ? 'Notes gently attract the pitch. Small bends still come through.' : 'Free pitch: every sideways movement bends the note.');
  });

  const draw = now => {
    if(disposed) return;
    const dt = previousFrame ? Math.min(.05, (now - previousFrame) / 1000) : 0;
    previousFrame = now;
    if(held.size) {
      const direction = Number(held.has('ArrowRight')) - Number(held.has('ArrowLeft'));
      rawMidi = clamp(rawMidi + direction * dt * 3.2, 57, 69);
      if(keyboardBow()) y = .5 + .19 * Math.sin(now * .0042);
    }
    const speed = pointer !== null ? velocityAt(now) : keyboardBow() ? .58 : 0;
    const active = pointer !== null || held.size > 0;
    // Keep the DSP watchdog alive only while a genuine gesture is held. A
    // stationary pointer sends zero excitation, even though contact continues.
    if(active && now - lastSend >= 18) {send(speed, true); lastSend = now;}
    const shown = demoVisual || {midi:pitch(), rawMidi, y, speed, contact:active};
    const shownMidi = clamp(shown.midi ?? pitch(), 57, 69);
    const markerMidi = clamp(shown.rawMidi ?? shownMidi, 57, 69);
    const shownSpeed = clamp(shown.speed || 0);
    const x = 5 + (markerMidi - 57) * 7.5;
    const energy = clamp((api.meter()?.rms || 0) * 5);
    const label = describePitch(shownMidi);
    pin.style.left = `${x}%`; pin.style.top = `${clamp(shown.y ?? y) * 100}%`;
    pin.classList.toggle('active', Boolean(shown.contact));
    lane.style.left = `${5 + (shownMidi - 57) * 7.5}%`;
    pitchReadout.textContent = label;
    surface.setAttribute('aria-valuenow', shownMidi.toFixed(2));
    surface.setAttribute('aria-valuetext', label);
    energyMeter.setAttribute('aria-valuenow', String(Math.round(shownSpeed * 100)));
    energyFill.style.width = `${shownSpeed * 100}%`;
    stateReadout.textContent = shownSpeed > .025 ? 'Bowing' : energy > .025 ? 'Ringing' : shown.contact ? 'Still' : 'At rest';
    invitation.style.opacity = shown.contact || energy > .025 ? '0' : '1';
    let path = '';
    for(let i = 0; i <= 60; i++) {
      const u = i / 60;
      const wave = Math.sin(u * Math.PI) * (reduced ? 1.5 : Math.sin(u * Math.PI * 7 + now * .02) * 10) * energy;
      path += `${i ? 'L' : 'M'}${50 + u * 900} ${(170 + wave).toFixed(2)}`;
    }
    string.setAttribute('d', path);
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  return {
    reset() {cancel(); rawMidi = 62; y = .5; snap.checked = true; lastSend = -Infinity;},
    cancel,
    dispose() {disposed = true; cancel(); cancelAnimationFrame(frame); for(const remove of listeners) remove(); container.innerHTML = '';},
    demoFrame(visual) {demoVisual = visual || null;},
  };
}

const events = [];
const bowY = at => .5 + .19 * Math.sin(2 * Math.PI * .62 * at);
for(let i = 0; i <= 205; i++) {
  const at = +(i * .04).toFixed(2);
  let rawMidi = 62;
  if(at >= 2 && at < 4.4) rawMidi = 62 + (at - 2) / 2.4 * 5;
  else if(at >= 4.4 && at < 6.8) rawMidi = 67 + .4 * Math.sin(2 * Math.PI * 4.2 * (at - 4.4));
  else if(at >= 6.8) rawMidi = 67;
  const speed = at < 6.8 ? clamp(Math.abs(.19 * 2 * Math.PI * .62 * Math.cos(2 * Math.PI * .62 * at)) * 1.35) : 0;
  const midi = attractedPitch(rawMidi);
  events.push({at, command:{type:'bow', active:at < 8.2, speed, midi}, visual:{midi, rawMidi, y:bowY(Math.min(at, 6.8)), speed, contact:at < 8.2}});
}
for(const [at, hint] of [
  [0, 'A vertical stroke sustains D4. The height itself adds no effect.'],
  [2, 'Keep bowing while drifting sideways: the same voice glides upward.'],
  [4.4, 'A small sideways wobble adds vibrato without another attack.'],
  [6.8, 'Hold still. The bow stops feeding energy and the tone fades.'],
  [8.2, 'Lift away. Your turn: bow a note, then carry it somewhere.'],
]) events.push({at, hint});
events.sort((a, b) => a.at - b.at);
export const demo = {duration:10.4, events};
