const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const notes = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const noteName = midi => `${notes[Math.round(midi) % 12]}${Math.floor(Math.round(midi) / 12) - 1}`;
const marks = [[57,'A3'],[59,'B'],[60,'C4'],[62,'D'],[64,'E'],[65,'F'],[67,'G'],[69,'A4']];
const decayAt = y => 0.18 * (8 / 0.18) ** (1 - y);
const yAtDecay = d => 1 - Math.log(d / 0.18) / Math.log(8 / 0.18);

export function mount(container, api) {
  container.innerHTML = `
    <style>
      #slide-experiment .slide-guide{display:flex;justify-content:space-between;gap:1rem;margin:0 0 .6rem}
      #slide-experiment .slide-guide strong{font:600 1.15rem ui-serif,Georgia,serif}
      #slide-experiment .slide-guide span{font-size:.8rem;color:var(--accent)}
      #slide-ribbon{position:relative;min-height:290px;overflow:hidden;touch-action:none;cursor:crosshair;user-select:none;background:linear-gradient(180deg,rgba(var(--accent-rgb),.12),transparent 72%);border:1px solid rgba(var(--accent-rgb),.24);border-radius:18px}
      #slide-ribbon:focus-visible{outline:3px solid var(--accent);outline-offset:4px}
      #slide-experiment .slide-fret{position:absolute;top:42px;bottom:42px;border-left:1px solid rgba(var(--accent-rgb),.18);pointer-events:none}
      #slide-experiment .slide-fret span{position:absolute;top:12px;left:7px;font-size:.7rem;font-weight:600;opacity:.7}
      #slide-experiment .slide-edge{position:absolute;left:18px;font-size:.64rem;letter-spacing:.15em;pointer-events:none;color:var(--accent)}
      #slide-experiment .slide-edge.top{top:17px} #slide-experiment .slide-edge.bottom{bottom:17px}
      #slide-experiment svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
      #slide-experiment .slide-pin{position:absolute;width:34px;height:34px;border-radius:50%;transform:translate(-50%,-50%);background:var(--accent);box-shadow:0 0 0 7px rgba(var(--accent-rgb),.10);pointer-events:none;opacity:.6}
      #slide-experiment .slide-pin.active{opacity:1;box-shadow:0 0 0 12px rgba(var(--accent-rgb),.12)}
      #slide-experiment .slide-pin:after{content:'';position:absolute;inset:11px;border-radius:50%;background:#fff9ed}
      #slide-experiment .slide-bottom{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-top:16px}
      #slide-experiment .slide-snap{display:flex;align-items:center;gap:9px;min-height:44px;cursor:pointer;font-size:.86rem}
      #slide-experiment .slide-snap input{width:18px;height:18px;accent-color:var(--accent)}
      #slide-experiment .slide-readout{font-variant-numeric:tabular-nums;font-size:.82rem}
      #slide-experiment .slide-help{font-size:.8rem;margin:14px 0 0;line-height:1.6}
      @media(max-width:520px){#slide-ribbon{min-height:270px}#slide-experiment .slide-guide span{max-width:150px;text-align:right}#slide-experiment .slide-fret span{left:3px;font-size:.62rem}}
      @media(prefers-reduced-motion:reduce){#slide-experiment .slide-pin{transition:none}}
    </style>
    <section id="slide-experiment">
      <div class="slide-guide"><strong>A note under your finger</strong><span>Touch once. Keep shaping the ring.</span></div>
      <div id="slide-ribbon" class="play-surface" tabindex="0" role="slider" aria-label="Slide pitch ribbon. Space plucks; left and right change pitch; up and down change ring length." aria-valuemin="57" aria-valuemax="69" aria-valuenow="62" aria-valuetext="D4, ring 4.2 seconds">
        <span class="slide-edge top">↑ LET IT RING</span>
        ${marks.map(([m,n])=>`<div class="slide-fret" style="left:${5 + (m-57)/12*90}%"><span>${n}</span></div>`).join('')}
        <svg viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true"><path id="slide-thread" d="M 50 150 L 950 150" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".45"/></svg>
        <div id="slide-pin" class="slide-pin"></div>
        <span class="slide-edge bottom">↓ SHORTEN THE TAIL</span>
      </div>
      <div class="slide-bottom instrument-controls">
        <button id="slide-pluck" type="button" class="small-button">Pluck this note</button>
        <label class="slide-snap"><input id="slide-snap" type="checkbox">Land on notes</label>
        <output id="slide-readout" class="readout slide-readout">D4 · 4.2 s ring</output>
      </div>
      <p class="slide-help muted">Slide sideways for pitch; move up to linger or down to fade. Lifting your finger leaves the tail.<br>Keyboard: focus the ribbon, Space to pluck, ← → for pitch, ↑ ↓ for ring.</p>
    </section>`;
  const ribbon = container.querySelector('#slide-ribbon');
  const snap = container.querySelector('#slide-snap');
  const pin = container.querySelector('#slide-pin');
  const thread = container.querySelector('#slide-thread');
  const readout = container.querySelector('#slide-readout');
  const pluck = container.querySelector('#slide-pluck');
  const cleanup = [];
  let midi = 62, decay = 4.2, pointer = null, keyHeld = false, disposed = false, demoActive = false;
  let raf;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const on = (el, type, fn) => {el.addEventListener(type, fn); cleanup.push(()=>el.removeEventListener(type, fn));};
  const draw = () => {
    const x = 5 + (midi - 57) / 12 * 90;
    const y = 15 + yAtDecay(decay) * 70;
    pin.style.left = `${x}%`; pin.style.top = `${y}%`;
    pin.classList.toggle('active', pointer !== null || keyHeld || demoActive);
    const label = `${noteName(midi)}${!snap.checked && Math.abs(midi - Math.round(midi)) > .03 ? ` ${Math.round((midi-Math.round(midi))*100)>0?'+':''}${Math.round((midi-Math.round(midi))*100)}¢` : ''}`;
    readout.textContent = `${label} · ${decay.toFixed(1)} s ring`;
    ribbon.setAttribute('aria-valuenow', midi.toFixed(2));
    ribbon.setAttribute('aria-valuetext', `${label}, ring ${decay.toFixed(1)} seconds`);
    const energy = Math.min(1, (api.meter()?.rms || 0) * 6);
    const amount = reduced ? energy * 4 : Math.sin(performance.now() * .019) * energy * 16;
    thread.setAttribute('d', `M 50 150 Q ${x*10} ${y*3 + amount} 950 150`);
  };
  const animate = () => { if(disposed) return; draw(); raf = requestAnimationFrame(animate); };
  const startInput = () => {
    api.interact(); demoActive = false;
    if(!api.ready()) { api.hint('Enable audio above, then touch the ribbon.'); return false; }
    return true;
  };
  const sendGesture = () => api.send({type:'gesture', midi, decay});
  const point = event => {
    const r = ribbon.getBoundingClientRect();
    const x = clamp(((event.clientX-r.left)/r.width - .05)/.90, 0, 1);
    const y = clamp(((event.clientY-r.top)/r.height - .15)/.70, 0, 1);
    midi = 57 + x*12;
    if(snap.checked) midi = Math.round(midi);
    decay = decayAt(y);
  };
  on(ribbon, 'pointerdown', event => {
    if(pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if(!startInput()) return;
    event.preventDefault(); ribbon.focus({preventScroll:true}); pointer = event.pointerId;
    ribbon.setPointerCapture(pointer); point(event);
    api.send({type:'pluck', midi, decay, strength:.82});
    api.hint('One pluck. Slide sideways; lift for a tail.'); draw();
  });
  on(ribbon, 'pointermove', event => {
    if(event.pointerId !== pointer) return;
    event.preventDefault(); point(event); sendGesture(); draw();
  });
  const endPointer = event => {
    if(event.pointerId !== pointer) return;
    const id = pointer; pointer = null;
    if(ribbon.hasPointerCapture(id)) ribbon.releasePointerCapture(id);
    api.send({type:'release'}); draw();
  };
  on(ribbon, 'pointerup', endPointer); on(ribbon, 'pointercancel', endPointer); on(ribbon, 'lostpointercapture', endPointer);
  on(ribbon, 'keydown', event => {
    if(![' ','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault(); if(!startInput()) return;
    if(event.key===' ' || event.key==='Enter') {
      if(keyHeld || event.repeat) return;
      keyHeld = true; api.send({type:'pluck', midi, decay, strength:.82});
    } else {
      if(event.key==='ArrowLeft' || event.key==='ArrowRight') {
        midi = clamp(midi + (event.key==='ArrowRight'?1:-1) * (snap.checked?1:.25), 57, 69);
        if(snap.checked) midi = Math.round(midi);
      } else decay = clamp(decay * (event.key==='ArrowUp'?1.3:1/1.3), .18, 8);
      sendGesture();
    }
    draw();
  });
  on(ribbon, 'keyup', event => {if(event.key===' ' || event.key==='Enter') {keyHeld=false; api.send({type:'release'});draw();}});
  on(ribbon, 'blur', () => {keyHeld=false; api.send({type:'release'});draw();});
  on(snap, 'change', () => {api.interact();demoActive=false;if(snap.checked)midi=Math.round(midi);sendGesture();draw();});
  on(pluck, 'click', () => {if(startInput()) {api.send({type:'pluck',midi,decay,strength:.82});api.hint('Now slide on the ribbon, or focus it and use the arrow keys.');}});
  const cancel = () => {
    const id = pointer; pointer=null;keyHeld=false;demoActive=false;
    if(id !== null && ribbon.hasPointerCapture(id)) ribbon.releasePointerCapture(id);
    draw();
  };
  animate();
  return {
    reset(){cancel();midi=62;decay=4.2;snap.checked=false;draw();},
    cancel,
    dispose(){disposed=true;cancelAnimationFrame(raf);cancel();cleanup.forEach(fn=>fn());container.innerHTML='';},
    demoFrame(v){if(!v){demoActive=false;draw();return;}if(Number.isFinite(v.midi))midi=clamp(v.midi,57,69);if(Number.isFinite(v.decay))decay=clamp(v.decay,.18,8);if('active' in v)demoActive=Boolean(v.active);draw();}
  };
}

const events = [
  {at:0, command:{type:'pluck',midi:57,decay:8,strength:.88},visual:{midi:57,decay:8,active:true},hint:'One pluck at A3. The same note will slide upward.'},
];
for(let i=1;i<=35;i++) events.push({at:.55+i*.04,command:{type:'gesture',midi:57+12*i/35,decay:8},visual:{midi:57+12*i/35,decay:8}});
events.push({at:2.1,hint:'Rock around the high A for vibrato.'});
for(let i=0;i<=40;i++) events.push({at:2.15+i*.035,command:{type:'gesture',midi:68.65+.35*Math.sin(i*.65),decay:8},visual:{midi:68.65+.35*Math.sin(i*.65),decay:8}});
for(let i=1;i<=20;i++) events.push({at:3.65+i*.04,command:{type:'gesture',midi:69-7*i/20,decay:8},visual:{midi:69-7*i/20,decay:8}});
events.push({at:4.55,hint:'Move down to shorten the remaining ring.'});
for(let i=1;i<=20;i++) events.push({at:4.55+i*.04,command:{type:'gesture',midi:62,decay:8*(.18/8)**(i/20)},visual:{midi:62,decay:8*(.18/8)**(i/20)}});
events.push(
  {at:5.5,command:{type:'release'},visual:{active:false},hint:'Lift. There is no second attack.'},
  {at:6.3,command:{type:'pluck',midi:64,decay:2.8,strength:.8},visual:{midi:64,decay:2.8,active:true},hint:'A fresh touch starts the next phrase.'},
  {at:6.7,command:{type:'gesture',midi:67,decay:2.8},visual:{midi:67,decay:2.8}},
  {at:7.1,command:{type:'gesture',midi:64,decay:2.8},visual:{midi:64,decay:2.8}},
  {at:7.5,command:{type:'release'},visual:{active:false},hint:'Your turn: find two notes, then shape their ending.'}
);
export const demo = {duration:9, events};
