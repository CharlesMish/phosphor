const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const character = (x) => x < 0.28 ? 'Wood · short & rounded' : x > 0.72 ? 'Metal · bright & lingering' : 'Open · clear string';

export const demo = {
  duration: 10.6,
  events: [
    {at: 0, command: {type: 'pluck', position: 0, strength: 0.72}, visual: {pluck: 0, body: 0}, hint: 'Left: a short, rounded wooden knock.'},
    {at: 1.6, command: {type: 'pluck', position: 0.5, strength: 0.72}, visual: {pluck: 0.5, body: 0.5}, hint: 'Middle: the open string.'},
    {at: 3.2, command: {type: 'pluck', position: 1, strength: 0.72}, visual: {pluck: 1, body: 1}, hint: 'Right: bright body modes and a longer tail.'},
    {at: 5.4, command: {type: 'pluck', position: 0.5, strength: 0.72}, visual: {pluck: 0.5, body: 0.5}, hint: 'One more pluck. Now reshape that same ringing note.'},
    {at: 6.1, command: {type: 'body', value: 0.65}, visual: {body: 0.65}},
    {at: 6.3, command: {type: 'body', value: 0.8}, visual: {body: 0.8}},
    {at: 6.5, command: {type: 'body', value: 1}, visual: {body: 1}, hint: 'Slide the body toward metal; there is no new pluck.'},
    {at: 8, command: {type: 'body', value: 0.72}, visual: {body: 0.72}},
    {at: 8.2, command: {type: 'body', value: 0.4}, visual: {body: 0.4}},
    {at: 8.4, command: {type: 'body', value: 0}, visual: {body: 0}, hint: 'Toward wood: the remaining tail rounds off and dies away.'},
    {at: 10, visual: {release: true}},
  ],
};

export function mount(container, api) {
  container.innerHTML = `
    <section id="resonant-instrument" aria-label="Resonant Ends instrument">
      <style>
        #resonant-instrument .resonant-labels{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center;margin:0 0 10px}
        #resonant-instrument .resonant-labels strong{display:block;font-size:.91rem;font-weight:650}
        #resonant-instrument .resonant-labels span{font-size:.73rem;opacity:.65}
        #resonant-instrument #resonant-surface{position:relative;overflow:hidden;min-height:250px;border-radius:18px;touch-action:none;cursor:crosshair;background:linear-gradient(90deg,rgba(178,113,51,.09),rgba(250,249,245,.28) 50%,rgba(110,111,177,.12))}
        #resonant-instrument #resonant-surface:focus-visible{outline:3px solid var(--accent);outline-offset:4px}
        #resonant-instrument svg{display:block;width:100%;height:250px;overflow:visible}
        #resonant-instrument .resonant-zone-line{stroke:currentColor;stroke-opacity:.09;stroke-dasharray:3 7}
        #resonant-instrument .resonant-endpoint{fill:#605e57}
        #resonant-instrument #resonant-string{fill:none;stroke:var(--accent,#716749);stroke-width:2.6;stroke-linecap:round}
        #resonant-instrument #resonant-contact{fill:var(--accent,#716749);stroke:#fcfaf5;stroke-width:4;pointer-events:none}
        #resonant-instrument .resonant-surface-caption{position:absolute;left:12px;right:12px;bottom:12px;text-align:center;font-size:.78rem;opacity:.72;pointer-events:none}
        #resonant-instrument .resonant-region-buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:12px 0 21px}
        #resonant-instrument .resonant-region-buttons button{min-height:44px}
        #resonant-instrument .resonant-body-label{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:.85rem}
        #resonant-instrument #resonant-body{display:block;width:100%;height:48px;margin:7px 0 0;accent-color:var(--accent);cursor:ew-resize;touch-action:pan-y;background:transparent}
        #resonant-instrument #resonant-body::-webkit-slider-runnable-track{height:10px;border-radius:10px;background:linear-gradient(90deg,#bb9168,#b7b7a8 50%,#a4a9d1)}
        #resonant-instrument #resonant-body::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:28px;height:28px;border-radius:50%;margin-top:-9px;background:#fffdf8;border:3px solid var(--accent,#716749);box-shadow:0 2px 5px #0002}
        #resonant-instrument #resonant-body{-webkit-appearance:none;appearance:none}
        #resonant-instrument #resonant-body::-moz-range-track{height:10px;border-radius:10px;background:linear-gradient(90deg,#bb9168,#b7b7a8 50%,#a4a9d1)}
        #resonant-instrument #resonant-body::-moz-range-thumb{width:23px;height:23px;border-radius:50%;background:#fffdf8;border:3px solid var(--accent,#716749)}
        #resonant-instrument .resonant-body-ends{display:flex;justify-content:space-between;font-size:.71rem;opacity:.65;margin-top:-4px}
        #resonant-instrument .resonant-note{font-size:.77rem;line-height:1.5;margin-top:14px;opacity:.7}
        @media(max-width:520px){#resonant-instrument #resonant-surface{min-height:225px}#resonant-instrument svg{height:225px}#resonant-instrument .resonant-labels span{font-size:.67rem}#resonant-instrument .resonant-region-buttons{gap:6px}#resonant-instrument .resonant-region-buttons button{font-size:.75rem;padding:7px}}
      </style>
      <div class="resonant-labels" aria-hidden="true"><div><strong>Wood</strong><span>short · rounded</span></div><div><strong>Open</strong><span>clear · ringing</span></div><div><strong>Metal</strong><span>bright · lingering</span></div></div>
      <div id="resonant-surface" class="play-surface" tabindex="0" role="button" aria-label="Pluck the sound landscape. Pull down or up and release; position chooses wood, open, or metal. Keyboard: arrow keys choose position, Space or Enter plucks.">
        <svg viewBox="0 0 1000 280" preserveAspectRatio="none" aria-hidden="true">
          <path class="resonant-zone-line" d="M347 18V250 M653 18V250"/>
          <path d="M40 140H960" stroke="currentColor" stroke-opacity=".08"/>
          <circle class="resonant-endpoint" cx="40" cy="140" r="5"/><circle class="resonant-endpoint" cx="960" cy="140" r="5"/>
          <path id="resonant-string" d="M40 140H960"/>
          <circle id="resonant-contact" cx="500" cy="140" r="8" opacity="0"/>
        </svg>
        <span class="resonant-surface-caption" id="resonant-caption">Choose a place, pull the string, release.</span>
      </div>
      <div class="resonant-region-buttons" aria-label="Pluck a region">
        <button type="button" class="small-button" data-resonant-pluck="0">Pluck wood</button>
        <button type="button" class="small-button" data-resonant-pluck="0.5">Pluck open</button>
        <button type="button" class="small-button" data-resonant-pluck="1">Pluck metal</button>
      </div>
      <div class="control-strip">
        <div class="resonant-body-label"><label for="resonant-body">Reshape the ringing body</label><output id="resonant-character" for="resonant-body">Open · clear string</output></div>
        <input id="resonant-body" type="range" min="0" max="100" step="1" value="50" aria-label="Body character: wood to open to metal"/>
        <div class="resonant-body-ends" aria-hidden="true"><span>Wood</span><span>Open</span><span>Metal</span></div>
      </div>
      <p class="resonant-note">Slide the body while a note rings. It changes that sound without another attack. These are three designed characters, blended along one string.</p>
    </section>`;

  const abort = new AbortController();
  const on = (element, name, fn, options = {}) => element.addEventListener(name, fn, {...options, signal: abort.signal});
  const surface = container.querySelector('#resonant-surface');
  const string = container.querySelector('#resonant-string');
  const contact = container.querySelector('#resonant-contact');
  const caption = container.querySelector('#resonant-caption');
  const bodyInput = container.querySelector('#resonant-body');
  const readout = container.querySelector('#resonant-character');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let pointer = null;
  let chosenPosition = 0.5;
  let bodyPosition = 0.5;
  let pull = 0;
  let demoPosition = null;
  let demoFlashUntil = 0;
  let lastPluck = -10000;
  let frame = 0;
  let disposed = false;

  function showBody(value) {
    bodyPosition = clamp(value, 0, 1);
    bodyInput.value = String(Math.round(bodyPosition * 100));
    readout.textContent = character(bodyPosition);
  }
  function ready() {
    if (api.ready()) return true;
    api.hint('Enable audio above, then pull and release the string.');
    return false;
  }
  function pluck(position, strength) {
    if (!api.send({type: 'pluck', position, strength})) return;
    chosenPosition = position;
    showBody(position);
    lastPluck = performance.now();
    api.hint(`${character(position)}. Slide the body below to reshape this note.`);
    caption.textContent = 'Now slide the body, or pluck somewhere else.';
  }
  function point(event) {
    const rect = surface.getBoundingClientRect();
    return {x: clamp((event.clientX - rect.left) / rect.width, 0.04, 0.96), y: (event.clientY - rect.top) / rect.height};
  }
  function releaseCapture() {
    const id = pointer?.id;
    pointer = null;
    pull = 0;
    if (id !== undefined && surface.hasPointerCapture(id)) surface.releasePointerCapture(id);
  }
  on(surface, 'pointerdown', (event) => {
    if (pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    api.interact();
    if (!ready()) return;
    event.preventDefault();
    const p = point(event);
    chosenPosition = clamp((p.x - 0.04) / 0.92, 0, 1);
    pointer = {id: event.pointerId, startY: p.y};
    pull = 0;
    surface.setPointerCapture(event.pointerId);
    caption.textContent = `${character(chosenPosition)} · pull farther for a stronger attack`;
  });
  on(surface, 'pointermove', (event) => {
    if (pointer?.id !== event.pointerId) return;
    const p = point(event);
    chosenPosition = clamp((p.x - 0.04) / 0.92, 0, 1);
    pull = clamp((p.y - pointer.startY) * 280, -110, 110);
    caption.textContent = `${character(chosenPosition)} · ${Math.round(clamp(0.22 + Math.abs(pull) / 115, 0.22, 1) * 100)}% pull`;
  });
  on(surface, 'pointerup', (event) => {
    if (pointer?.id !== event.pointerId) return;
    const strength = Math.abs(pull) < 4 ? 0.64 : clamp(0.22 + Math.abs(pull) / 115, 0.22, 1);
    releaseCapture();
    pluck(chosenPosition, strength);
  });
  on(surface, 'pointercancel', (event) => {if (pointer?.id === event.pointerId) {releaseCapture(); caption.textContent = 'Gesture cancelled. Pull and release to play.';}});
  on(surface, 'lostpointercapture', (event) => {if (pointer?.id === event.pointerId) {pointer = null; pull = 0;}});
  on(surface, 'keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); api.interact();
      chosenPosition = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : clamp(chosenPosition + (event.key === 'ArrowLeft' ? -0.1 : 0.1), 0, 1);
      caption.textContent = `${character(chosenPosition)} · press Space to pluck`;
      api.hint(caption.textContent);
    } else if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
      event.preventDefault(); api.interact(); if (ready()) pluck(chosenPosition, 0.72);
    }
  });
  for (const button of container.querySelectorAll('[data-resonant-pluck]')) {
    on(button, 'click', () => {api.interact(); if (ready()) pluck(Number(button.dataset.resonantPluck), 0.72);});
  }
  on(bodyInput, 'pointerdown', () => api.interact());
  on(bodyInput, 'keydown', () => api.interact());
  on(bodyInput, 'input', () => {
    showBody(Number(bodyInput.value) / 100);
    if (api.send({type: 'body', value: bodyPosition})) api.hint(`${character(bodyPosition)} · reshaping the existing tail`);
    else api.hint('Enable audio, pluck a note, then slide its body.');
  });

  function draw(now) {
    if (disposed) return;
    const level = api.meter()?.rms || 0;
    const visualPosition = demoPosition ?? chosenPosition;
    const x = 50 + visualPosition * 900;
    if (pointer) {
      string.setAttribute('d', `M40 140 L${x} ${140 + pull} L960 140`);
      contact.setAttribute('cx', x);
      contact.setAttribute('cy', 140 + pull);
      contact.setAttribute('opacity', '1');
    } else {
      const amplitude = reduced.matches ? 0 : Math.min(18, level * 100);
      const y = Math.sin(now * 0.028) * amplitude;
      string.setAttribute('d', `M40 140 Q270 ${140 + y} 500 140 Q730 ${140 - y} 960 140`);
      contact.setAttribute('cx', x);
      contact.setAttribute('cy', '140');
      contact.setAttribute('opacity', now < demoFlashUntil || now - lastPluck < 220 ? '0.85' : '0');
    }
    frame = requestAnimationFrame(draw);
  }
  frame = requestAnimationFrame(draw);

  return {
    reset() {
      releaseCapture(); chosenPosition = 0.5; demoPosition = null; demoFlashUntil = 0; lastPluck = -10000;
      showBody(0.5); caption.textContent = 'Choose a place, pull the string, release.';
    },
    cancel() { releaseCapture(); demoPosition = null; demoFlashUntil = 0; },
    dispose() { disposed = true; releaseCapture(); abort.abort(); cancelAnimationFrame(frame); },
    demoFrame(event) {
      if (!event) {demoPosition = null; demoFlashUntil = 0; return;}
      if (Number.isFinite(event.body)) showBody(event.body);
      if (Number.isFinite(event.pluck)) {demoPosition = event.pluck; chosenPosition = event.pluck; demoFlashUntil = performance.now() + 550;}
      if (event.release) demoPosition = null;
    },
  };
}
