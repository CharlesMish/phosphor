const clamp = (n, low=0, high=1) => Math.max(low, Math.min(high,n));

const demoEvents = [];
for (let i=0; i<=132; i++) {
  const at = +(i*.055).toFixed(3);
  let speed, roughness, x;
  if (at<1.9) { speed=.18; roughness=.14; x=.12+at/1.9*.70; }
  else if (at<3.85) { speed=.52; roughness=.46; x=.82-(at-1.9)/1.95*.67; }
  else if (at<5.8) { speed=.82; roughness=.90; x=.15+(at-3.85)/1.95*.72; }
  else { speed=0; roughness=.90; x=.87; }
  demoEvents.push({at,command:{type:'bow',active:at<7.2,speed,roughness},
    visual:{x,roughness,speed,contact:at<7.2}});
}
const captions = [
  [0,'A slow stroke brings a soft tone to life.'],
  [1.925,'Reverse and move faster to feed the string more energy.'],
  [3.85,'Move down for grain; the stronger stroke grows brighter.'],
  [5.83,'Hold still. No new energy enters; the string fades.'],
  [7.26,'Lift away and leave the remaining tail.'],
];
for (const [at,hint] of captions) demoEvents.push({at,hint});
demoEvents.sort((a,b)=>a.at-b.at);
export const demo = {duration:9.4,events:demoEvents};

export function mount(container,api) {
  container.innerHTML = `
    <style>
      #bow-experiment .bow-intro{margin:0 0 16px;line-height:1.5;max-width:58ch}
      #bow-experiment .bow-stage{position:relative;min-height:290px;height:clamp(290px,38vw,370px);touch-action:none;user-select:none;cursor:ew-resize;overflow:hidden}
      #bow-experiment .bow-stage:focus-visible{outline:3px solid var(--accent);outline-offset:4px}
      #bow-experiment .bow-stage svg{width:100%;height:100%;display:block;pointer-events:none}
      #bow-experiment .bow-axis{position:absolute;left:20px;font-size:11px;letter-spacing:.12em;font-weight:650;pointer-events:none;color:#777771}
      #bow-experiment .bow-axis.top{top:18px}#bow-experiment .bow-axis.bottom{bottom:18px}
      #bow-experiment .bow-center{position:absolute;inset:0;display:grid;place-items:center;text-align:center;pointer-events:none;transition:opacity .15s}
      #bow-experiment .bow-center span{margin-top:110px;background:#fcfaf5d9;padding:7px 12px;border-radius:20px;font-size:13px;color:#767670}
      #bow-experiment .bow-meta{display:flex;gap:24px;flex-wrap:wrap;padding-top:16px;align-items:center}
      #bow-experiment .bow-meter{display:flex;align-items:center;gap:10px;font-size:12px;min-width:175px}
      #bow-experiment .bow-meter-track{height:5px;width:100px;background:#d9d6cb;border-radius:8px;overflow:hidden}
      #bow-experiment .bow-meter-fill{display:block;height:100%;width:0;background:var(--accent);border-radius:8px;transition:width .04s}
      #bow-experiment .bow-detail{margin:14px 0 0;font-size:12px;line-height:1.6;color:#73736c}
      #bow-experiment .bow-contact{opacity:0}
      @media(prefers-reduced-motion:reduce){#bow-experiment *{transition:none!important}}
    </style>
    <section id="bow-experiment">
      <p class="bow-intro">Rub left and right to grow a tone. Move down for more grain; hold still to let it fade.</p>
      <div id="bow-surface" class="play-surface bow-stage" tabindex="0" role="group" aria-label="Bowing surface. Rub left and right. Move downward for grain. Keyboard: hold left or right arrow to bow, up or down to change grain.">
        <span class="bow-axis top">SILK</span><span class="bow-axis bottom">GRAIN</span>
        <svg viewBox="0 0 800 340" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="bow-grain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0"/><stop offset="1" stop-color="var(--accent)" stop-opacity=".07"/></linearGradient></defs>
          <rect x="0" y="0" width="800" height="340" fill="url(#bow-grain)"/>
          <path d="M60 170H740" stroke="#c6c1b3" stroke-width="1"/>
          <path id="bow-string" d="M60 170H740" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="60" cy="170" r="6" fill="#9b988b"/><circle cx="740" cy="170" r="6" fill="#9b988b"/>
          <g id="bow-contact" class="bow-contact">
            <path d="M-26 -62L26 62" stroke="#55594f" stroke-width="11" stroke-linecap="round"/>
            <path d="M-19 -63L33 61" stroke="#dbba78" stroke-width="2.5" stroke-linecap="round"/>
            <circle r="24" fill="var(--accent)" opacity=".09"/>
            <circle r="5" fill="var(--accent)"/>
          </g>
        </svg>
        <div id="bow-invitation" class="bow-center"><span>Touch and move · silence becomes a phrase</span></div>
      </div>
      <div class="bow-meta">
        <div class="bow-meter"><span>Movement</span><span class="bow-meter-track"><i id="bow-speed" class="bow-meter-fill"></i></span></div>
        <span class="readout" id="bow-character">Silk ↔ grain</span>
      </div>
      <p class="bow-detail">One A3 string · a synthetic bow texture. On a keyboard, hold ← or → to bow and use ↑ / ↓ to change grain.</p>
    </section>`;
  const surface = container.querySelector('#bow-surface');
  const path = container.querySelector('#bow-string');
  const contactMark = container.querySelector('#bow-contact');
  const speedBar = container.querySelector('#bow-speed');
  const character = container.querySelector('#bow-character');
  const invitation = container.querySelector('#bow-invitation');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const listeners=[];
  let pointer=null, x=.5, roughness=.38, speed=0, lastX=0, lastTime=0;
  let lastMove=-1e9, lastSend=-1e9, frame=0, disposed=false, demoVisual=null;
  let keyboard = new Set();
  function on(target,name,handler,options) {
    target.addEventListener(name,handler,options);
    listeners.push(()=>target.removeEventListener(name,handler,options));
  }
  function coordinates(event) {
    const rect=surface.getBoundingClientRect();
    return {x:clamp((event.clientX-rect.left)/rect.width),y:clamp((event.clientY-rect.top)/rect.height)};
  }
  function send(velocity,active) {
    api.send({type:'bow',active,speed:velocity,roughness});
  }
  function release() {
    const old=pointer;pointer=null;keyboard.clear();speed=0;
    if(old!==null && surface.hasPointerCapture(old)) surface.releasePointerCapture(old);
  }
  function finish(event) {
    if(pointer===null || event.pointerId!==pointer) return;
    release();send(0,false);api.hint('Lifted away. Let the string finish its phrase.');
  }
  on(surface,'pointerdown',event=>{
    if(pointer!==null || (event.pointerType==='mouse'&&event.button!==0)) return;
    api.interact();
    if(!api.ready()){api.hint('Enable audio, then rub the string left and right.');return;}
    event.preventDefault();surface.focus({preventScroll:true});
    const at=coordinates(event);x=at.x;roughness=at.y;
    pointer=event.pointerId;lastX=x;lastTime=performance.now();lastMove=lastTime;speed=0;
    surface.setPointerCapture(pointer);send(0,true);
    api.hint('Move left and right to supply energy. Downward adds grain.');
  });
  on(surface,'pointermove',event=>{
    if(event.pointerId!==pointer) return;
    event.preventDefault();
    const now=performance.now(),at=coordinates(event);
    const dt=Math.max(.008,Math.min(.16,(now-lastTime)/1000));
    const velocity=clamp(Math.abs(at.x-lastX)/dt*1.4);
    speed=speed*.38+velocity*.62;
    x=at.x;roughness=at.y;lastX=x;lastTime=now;lastMove=now;
    send(speed,true);lastSend=now;
  });
  on(surface,'pointerup',finish);
  on(surface,'pointercancel',finish);
  on(surface,'lostpointercapture',finish);
  on(surface,'keydown',event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if(!event.repeat) api.interact();
    if(!api.ready()){api.hint('Enable audio first, then use the arrow keys.');return;}
    if(event.key==='ArrowUp'||event.key==='ArrowDown') {
      roughness=clamp(roughness+(event.key==='ArrowDown'?.08:-.08));
    } else keyboard.add(event.key);
    send(keyboard.size?.5:0,keyboard.size>0);
  });
  on(surface,'keyup',event=>{
    if(!keyboard.has(event.key)) return;
    event.preventDefault();keyboard.delete(event.key);
    if(!keyboard.size)send(0,false);
  });
  on(surface,'blur',()=>{if(keyboard.size){keyboard.clear();send(0,false);}});
  function draw(now) {
    if(disposed)return;
    let velocity=0;
    if(pointer!==null) {
      const age=now-lastMove;
      velocity=age<140?speed*Math.exp(-age/100):0;
    } else if(keyboard.size) {
      velocity=.5;
      x=clamp(x+(keyboard.has('ArrowRight')?.0025:-.0025),.09,.91);
      // A held key is the accessible continuous-stroke alternative.
    }
    if((pointer!==null||keyboard.size)&&now-lastSend>=32){send(velocity,true);lastSend=now;}
    const shown=demoVisual||{x,roughness,speed:velocity,contact:pointer!==null||keyboard.size>0};
    const meter=api.meter();
    const energy=clamp((meter?.rms||0)*5);
    const wave=reduced?0:energy*10;
    let d='';
    for(let i=0;i<=80;i++) {
      const u=i/80;
      const offset=Math.sin(u*Math.PI)*Math.sin(u*Math.PI*6+now*.02)*wave;
      d+=(i?'L':'M')+(60+u*680).toFixed(1)+' '+(170+offset).toFixed(1);
    }
    path.setAttribute('d',d);
    contactMark.setAttribute('transform',`translate(${60+shown.x*680} ${30+shown.roughness*280})`);
    contactMark.style.opacity=shown.contact?'1':'0';
    speedBar.style.width=`${Math.round(shown.speed*100)}%`;
    character.textContent=shown.roughness<.3?'Silky':shown.roughness<.68?'Warm grain':'Rough grain';
    invitation.style.opacity=shown.contact||energy>.03?'0':'1';
    frame=requestAnimationFrame(draw);
  }
  frame=requestAnimationFrame(draw);
  return {
    reset(){release();demoVisual=null;x=.5;roughness=.38;lastMove=-1e9;},
    cancel(){release();demoVisual=null;lastMove=-1e9;},
    dispose(){disposed=true;release();cancelAnimationFrame(frame);for(const remove of listeners)remove();},
    demoFrame(visual){demoVisual=visual;},
  };
}
