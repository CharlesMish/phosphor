export const demo = {
  duration: 10.5,
  events: [
    {at: 0, command: {type: 'damp', amount: 0}, visual: {damp: 0}, hint: 'Open: let the first pluck ring.'},
    {at: 0.1, command: {type: 'pluck', strength: 0.76, position: 0.38}, visual: {pluck: true}},
    {at: 2.4, command: {type: 'pluck', strength: 0.76, position: 0.38}, visual: {pluck: true}, hint: 'Catch: touch the strip after the attack.'},
    {at: 2.8, command: {type: 'damp', amount: 0.78}, visual: {damp: 0.78}},
    {at: 3.5, command: {type: 'damp', amount: 0}, visual: {damp: 0}, hint: 'Lift away: the absorbed ring stays gone.'},
    {at: 4.6, command: {type: 'damp', amount: 0.78}, visual: {damp: 0.78}, hint: 'Muted: hold the damper before the next pluck.'},
    {at: 4.65, command: {type: 'pluck', strength: 0.76, position: 0.38}, visual: {pluck: true}},
    {at: 5.6, command: {type: 'damp', amount: 0}, visual: {damp: 0}, hint: 'Then alternate open and muted.'},
    {at: 5.65, command: {type: 'pluck', strength: 0.76, position: 0.38}, visual: {pluck: true}},
    {at: 6.5, command: {type: 'damp', amount: 0.78}, visual: {damp: 0.78}},
    {at: 6.55, command: {type: 'pluck', strength: 0.76, position: 0.38}, visual: {pluck: true}},
    {at: 7.4, command: {type: 'damp', amount: 0}, visual: {damp: 0}},
    {at: 7.45, command: {type: 'pluck', strength: 0.76, position: 0.38}, visual: {pluck: true}},
    {at: 8.3, command: {type: 'damp', amount: 0.78}, visual: {damp: 0.78}},
    {at: 8.35, command: {type: 'pluck', strength: 0.76, position: 0.38}, visual: {pluck: true}},
    {at: 9.4, command: {type: 'damp', amount: 0}, visual: {damp: 0}, hint: 'Your turn: pluck, catch, and try holding the damper.'},
  ],
};

export function mount(container, api) {
  container.innerHTML = `
    <section id="catch-instrument" aria-label="Catch instrument">
      <style>
        #catch-instrument .catch-head {display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:.8rem}
        #catch-instrument .catch-label {text-transform:uppercase;letter-spacing:.14em;font-size:.68rem;font-weight:750}
        #catch-instrument .catch-stage {position:relative;touch-action:none;user-select:none;cursor:crosshair;min-height:220px;border:1px solid color-mix(in srgb,var(--accent) 24%,transparent);background:linear-gradient(180deg,rgba(255,255,255,.5),rgba(255,255,255,.05));border-radius:18px;overflow:hidden}
        #catch-instrument svg {display:block;width:100%;height:220px;overflow:visible}
        #catch-instrument .catch-string {fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linecap:round}
        #catch-instrument .catch-shadow {fill:none;stroke:var(--accent);stroke-width:12;opacity:.07}
        #catch-instrument .catch-stud {fill:var(--accent)}
        #catch-instrument .catch-guide {stroke:currentColor;stroke-dasharray:2 6;opacity:.13;stroke-width:1}
        #catch-instrument .catch-stage-caption {position:absolute;left:1.1rem;bottom:.75rem;margin:0;font-size:.76rem;opacity:.7;pointer-events:none}
        #catch-instrument .catch-meter {font-variant-numeric:tabular-nums;font-size:.78rem}
        #catch-instrument .catch-damper {position:relative;touch-action:none;user-select:none;cursor:ew-resize;min-height:88px;border:1px solid color-mix(in srgb,var(--accent) 32%,transparent);border-radius:14px;margin-top:.9rem;overflow:hidden;background:repeating-linear-gradient(90deg,transparent,transparent 7px,color-mix(in srgb,var(--accent) 7%,transparent) 7px,color-mix(in srgb,var(--accent) 7%,transparent) 8px)}
        #catch-instrument .catch-damper:focus-visible,#catch-instrument .catch-stage:focus-visible {outline:3px solid var(--accent);outline-offset:4px}
        #catch-instrument .catch-damper-fill {position:absolute;inset:0 auto 0 0;width:0;background:var(--accent);opacity:.18;pointer-events:none}
        #catch-instrument .catch-damper-content {position:relative;display:flex;align-items:center;justify-content:space-between;min-height:88px;gap:1rem;padding:.8rem 1.1rem;pointer-events:none}
        #catch-instrument .catch-damper-content strong {display:block;font-size:.88rem;margin-bottom:.35rem}
        #catch-instrument .catch-damper-content small {font-size:.72rem;opacity:.7}
        #catch-instrument .catch-damper-value {font-size:1.25rem;font-variant-numeric:tabular-nums;font-weight:650}
        #catch-instrument .instrument-controls {display:flex;flex-wrap:wrap;gap:.65rem;align-items:center;margin-top:1rem}
        #catch-instrument button {min-height:44px}
        #catch-instrument #catch-hold[aria-pressed=true] {background:var(--accent);color:white;border-color:var(--accent)}
        #catch-instrument .catch-setup {display:flex;align-items:center;gap:.6rem;margin-left:auto;font-size:.76rem}
        #catch-instrument .catch-setup input {width:110px;min-height:44px;accent-color:var(--accent)}
        #catch-instrument .catch-note {font-size:.76rem;line-height:1.6;margin:.8rem 0 0;opacity:.72}
        @media(max-width:540px) {#catch-instrument .catch-stage,#catch-instrument svg {min-height:190px;height:190px}#catch-instrument .catch-setup {flex-basis:100%;margin-left:0}#catch-instrument .catch-damper-content {padding:.7rem .8rem}}
      </style>
      <div class="catch-head"><span class="catch-label">One string · A3</span><span class="readout catch-meter" id="catch-status">Ready to pluck</span></div>
      <div id="catch-stage" class="play-surface catch-stage" tabindex="0" role="group" aria-label="String: pull up or down and release to pluck. Press Space or Enter to pluck.">
        <svg viewBox="0 0 800 220" preserveAspectRatio="none" aria-hidden="true">
          <line x1="40" y1="110" x2="760" y2="110" class="catch-guide"/>
          <path id="catch-shadow" class="catch-shadow" d="M 40 110 L 760 110"/>
          <path id="catch-line" class="catch-string" d="M 40 110 L 760 110"/>
          <circle cx="40" cy="110" r="6" class="catch-stud"/><circle cx="760" cy="110" r="6" class="catch-stud"/>
          <circle id="catch-finger" cx="314" cy="110" r="8" fill="var(--accent)" opacity="0"/>
        </svg>
        <p class="catch-stage-caption">Pull away from the string. Release to pluck.</p>
      </div>
      <div id="catch-damper" class="control-strip catch-damper" tabindex="0" role="slider" aria-label="Damper. Hold and move right for firmer damping; release to lift. Arrow keys latch an amount, Home releases it." aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="Open string">
        <div id="catch-damper-fill" class="catch-damper-fill"></div>
        <div class="catch-damper-content"><div><strong>Catch the ring</strong><small>Hold here · light brush ← → firm catch</small></div><span class="catch-damper-value" id="catch-damper-value">Open</span></div>
      </div>
      <div class="instrument-controls">
        <button type="button" class="small-button" id="catch-pluck">Pluck</button>
        <button type="button" class="small-button" id="catch-hold" aria-pressed="false">Hold damper</button>
        <label class="catch-setup" for="catch-decay">Natural ring <input id="catch-decay" type="range" min="0.4" max="8" step="0.1" value="5"><output id="catch-decay-value">5.0 s</output></label>
      </div>
      <p class="catch-note">Pluck, then catch the tail. For muted attacks, switch on Hold damper before plucking—or use a second finger on the strip. Moving right absorbs the ring faster.</p>
    </section>`;

  const q = id => container.querySelector(`#catch-${id}`);
  const stage = q('stage'), damper = q('damper'), hold = q('hold');
  const line = q('line'), shadow = q('shadow'), finger = q('finger');
  const status = q('status'), fill = q('damper-fill'), dampValue = q('damper-value');
  const decay = q('decay'), decayValue = q('decay-value');
  const listeners = [];
  const on = (node, type, handler, options) => {
    node.addEventListener(type, handler, options);
    listeners.push(() => node.removeEventListener(type, handler, options));
  };
  let pluckPointer = null, dampPointer = null, pull = null;
  let latched = false, latchAmount = 0.72, liveDamp = 0, displayedDamp = 0;
  let lastPluck = -Infinity, frame = 0, disposed = false;
  const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const clamp = (x, min, max) => Math.max(min, Math.min(max, x));

  function requireAudio() {
    api.interact();
    if (api.ready()) return true;
    api.hint('Enable audio first, then pull and release the string.');
    return false;
  }
  function paintDamp(amount) {
    displayedDamp = amount;
    const percent = Math.round(amount * 100);
    fill.style.width = `${percent}%`;
    dampValue.textContent = percent ? `${percent}%` : 'Open';
    damper.setAttribute('aria-valuenow', String(percent));
    damper.setAttribute('aria-valuetext', percent ? `${percent} percent damping` : 'Open string');
  }
  function sendDamp() {
    const amount = dampPointer !== null ? liveDamp : latched ? latchAmount : 0;
    paintDamp(amount);
    api.send({type: 'damp', amount});
    hold.setAttribute('aria-pressed', String(latched));
    hold.textContent = latched ? 'Release damper' : 'Hold damper';
  }
  function updatePull(event) {
    const r = stage.getBoundingClientRect();
    const position = clamp((event.clientX - r.left) / r.width, 0.08, 0.92);
    const dy = clamp((event.clientY - r.top - r.height / 2) / (r.height * 0.42), -1, 1);
    pull = {position, dy, strength: clamp(Math.abs(dy), 0.08, 1)};
    status.textContent = `Pull ${Math.round(pull.strength * 100)}%`;
  }
  function trigger(strength = 0.72, position = 0.38) {
    api.send({type: 'decay', seconds: Number(decay.value)});
    if (api.send({type: 'pluck', strength, position})) {
      lastPluck = performance.now();
      status.textContent = displayedDamp > 0 ? 'Muted attack' : 'Open ring';
      api.hint(displayedDamp > 0 ? 'Muted: release the damper before your next open pluck.' : 'Now touch the lower strip to catch the ringing note.');
    }
  }
  function updateDamp(event) {
    const r = damper.getBoundingClientRect();
    liveDamp = clamp((event.clientX - r.left) / r.width, 0.04, 1);
    latchAmount = liveDamp;
    sendDamp();
    status.textContent = 'Catching the ring';
  }
  function releaseCapture(element, id) {
    if (id !== null && element.hasPointerCapture(id)) element.releasePointerCapture(id);
  }
  function cancel() {
    const p = pluckPointer, d = dampPointer;
    pluckPointer = dampPointer = null;
    pull = null;
    releaseCapture(stage, p);
    releaseCapture(damper, d);
    latched = false;
    liveDamp = 0;
    sendDamp();
    status.textContent = 'Ready to pluck';
  }
  function reset() {
    cancel();
    latchAmount = 0.72;
    decay.value = '5';
    decayValue.textContent = '5.0 s';
    lastPluck = -Infinity;
  }

  on(stage, 'pointerdown', event => {
    if ((event.pointerType === 'mouse' && event.button !== 0) || pluckPointer !== null) return;
    if (!requireAudio()) return;
    event.preventDefault();
    pluckPointer = event.pointerId;
    stage.setPointerCapture(event.pointerId);
    updatePull(event);
  });
  on(stage, 'pointermove', event => {
    if (event.pointerId === pluckPointer) updatePull(event);
  });
  on(stage, 'pointerup', event => {
    if (event.pointerId !== pluckPointer) return;
    updatePull(event);
    const attack = pull;
    pluckPointer = null;
    pull = null;
    releaseCapture(stage, event.pointerId);
    trigger(attack.strength, attack.position);
  });
  const cancelPluck = event => {
    if (event.pointerId !== pluckPointer) return;
    pluckPointer = null;
    pull = null;
    status.textContent = 'Pluck cancelled';
  };
  on(stage, 'pointercancel', cancelPluck);
  on(stage, 'lostpointercapture', cancelPluck);
  on(stage, 'keydown', event => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!event.repeat && requireAudio()) trigger();
  });
  on(damper, 'pointerdown', event => {
    if ((event.pointerType === 'mouse' && event.button !== 0) || dampPointer !== null) return;
    if (!requireAudio()) return;
    event.preventDefault();
    dampPointer = event.pointerId;
    damper.setPointerCapture(event.pointerId);
    updateDamp(event);
  });
  on(damper, 'pointermove', event => {
    if (event.pointerId === dampPointer) updateDamp(event);
  });
  function finishDamp(event) {
    if (event.pointerId !== dampPointer) return;
    const id = dampPointer;
    dampPointer = null;
    liveDamp = 0;
    releaseCapture(damper, id);
    sendDamp();
    status.textContent = latched ? 'Damper held' : 'Damper lifted';
  }
  on(damper, 'pointerup', finishDamp);
  on(damper, 'pointercancel', finishDamp);
  on(damper, 'lostpointercapture', finishDamp);
  on(damper, 'keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!requireAudio()) return;
    const sign = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1;
    latchAmount = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : clamp((latched ? latchAmount : 0) + 0.1 * sign, 0, 1);
    latched = latchAmount > 0;
    sendDamp();
    api.hint(latched ? 'Damper held. Pluck for a muted attack; Home lifts the damper.' : 'Damper lifted. The next pluck will ring openly.');
  });
  on(q('pluck'), 'click', () => { if (requireAudio()) trigger(); });
  on(hold, 'click', () => {
    if (!requireAudio()) return;
    latched = !latched;
    if (latched && latchAmount === 0) latchAmount = 0.72;
    sendDamp();
    api.hint(latched ? 'Damper held: pluck for a muted attack. Touch the strip to change its firmness.' : 'Damper lifted: your next pluck will ring openly.');
  });
  on(decay, 'input', () => {
    api.interact();
    decayValue.textContent = `${Number(decay.value).toFixed(1)} s`;
    api.send({type: 'decay', seconds: Number(decay.value)});
  });
  function draw(now) {
    if (disposed) return;
    let d = 'M 40 110 L 760 110';
    if (pull) {
      const x = 40 + pull.position * 720, y = 110 + pull.dy * 76;
      d = `M 40 110 L ${x} ${y} L 760 110`;
      finger.setAttribute('cx', String(x));
      finger.setAttribute('cy', String(y));
      finger.setAttribute('opacity', '.85');
    } else {
      finger.setAttribute('opacity', '0');
      const rms = api.meter().rms || 0;
      const amplitude = reduceMotion ? 0 : Math.min(17, rms * 95) * Math.sin((now - lastPluck) * 0.041);
      if (Math.abs(amplitude) > 0.1) d = `M 40 110 Q 220 ${110 + amplitude} 400 110 Q 580 ${110 - amplitude} 760 110`;
    }
    line.setAttribute('d', d);
    shadow.setAttribute('d', d);
    frame = requestAnimationFrame(draw);
  }
  frame = requestAnimationFrame(draw);

  return {
    reset,
    cancel,
    dispose() {
      cancel();
      disposed = true;
      cancelAnimationFrame(frame);
      listeners.forEach(remove => remove());
      container.innerHTML = '';
    },
    demoFrame(event) {
      if (!event) {
        paintDamp(dampPointer !== null ? liveDamp : latched ? latchAmount : 0);
        if (!pull) status.textContent = 'Ready to pluck';
        return;
      }
      if (Number.isFinite(event.damp)) {
        paintDamp(event.damp);
        status.textContent = event.damp ? 'Catching the ring' : 'Open ring';
      }
      if (event.pluck) {
        lastPluck = performance.now();
        status.textContent = displayedDamp ? 'Muted attack' : 'Open ring';
      }
    },
  };
}
