import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../../public/string-lab/experiments/slide/engine.mjs';
import {demo} from '../../public/string-lab/experiments/slide/view.mjs';

function render(engine, seconds) {
  return Float64Array.from({length:Math.round(engine.sampleRate * seconds)}, () => engine.processSample());
}
const rms = values => Math.sqrt(values.reduce((sum, x) => sum+x*x,0)/values.length);
function estimatePitch(values, sampleRate) {
  const crosses=[];
  for(let i=1;i<values.length;i++) if(values[i-1]<=0 && values[i]>0) crosses.push(i-1-values[i-1]/(values[i]-values[i-1]));
  assert.ok(crosses.length>5,'enough cycles for output pitch measurement');
  return sampleRate*(crosses.length-1)/(crosses.at(-1)-crosses[0]);
}
function checkSamples(values) {
  let peak=0,jump=0;
  for(let i=0;i<values.length;i++) {
    assert.ok(Number.isFinite(values[i]),'finite rendered sample');
    peak=Math.max(peak,Math.abs(values[i]));
    if(i) jump=Math.max(jump,Math.abs(values[i]-values[i-1]));
  }
  assert.ok(peak<=.75,`headroom ${peak}`);
  assert.ok(jump<.13,`bounded waveform slope ${jump}`);
  return {peak,jump};
}

for(const sampleRate of [44100,48000]) {
  test(`Slide ${sampleRate}: A3, D4, A4 settle at their promised pitches`,()=>{
    for(const midi of [57,62,69]) {
      const e=new Engine(sampleRate); e.command({type:'pluck',midi,decay:8,strength:.8});
      render(e,.25); const out=render(e,.12);checkSamples(out);
      const found=estimatePitch(out,sampleRate), expected=440*2**((midi-69)/12);
      assert.ok(Math.abs(1200*Math.log2(found/expected))<2,`pitch ${found} vs ${expected}`);
    }
  });
  test(`Slide ${sampleRate}: one attack glides through an octave and release retains a tail`,()=>{
    const e=new Engine(sampleRate);e.command({type:'pluck',midi:57,decay:8});
    render(e,.2);
    const low=render(e,.12);
    for(let i=1;i<=60;i++){e.command({type:'gesture',midi:57+12*i/60,decay:8});checkSamples(render(e,.01));}
    render(e,.1);
    const high=render(e,.12);
    assert.ok(Math.abs(estimatePitch(low,sampleRate)-220)<.2);
    assert.ok(Math.abs(estimatePitch(high,sampleRate)-440)<.2);
    assert.ok(rms(high)>.04,'same excitation remains audible after slide');
    assert.ok(rms(high)<rms(low),'glide did not replenish decay energy');
    e.command({type:'release'});const tail=render(e,.12);
    assert.ok(rms(tail)>.02,'release retains sound');
    assert.ok(rms(tail)<rms(high),'release does not retrigger');
  });
  test(`Slide ${sampleRate}: downward gesture removes energy that cannot be restored`,()=>{
    const open=new Engine(sampleRate), damp=new Engine(sampleRate);
    for(const e of [open,damp]){e.command({type:'pluck',midi:62,decay:8});render(e,.2);}
    damp.command({type:'gesture',decay:.18});
    const openTail=render(open,.45), dampTail=render(damp,.45);
    assert.ok(rms(dampTail.slice(-sampleRate*.1)) < rms(openTail.slice(-sampleRate*.1))*.001,'actual remaining energy damping');
    damp.command({type:'gesture',decay:8});
    assert.ok(rms(render(damp,.4))<.00001,'lengthening does not resurrect the note');
  });
  test(`Slide ${sampleRate}: release is exactly non-attacking and gestures are continuous`,()=>{
    const a=new Engine(sampleRate), b=new Engine(sampleRate);
    for(const e of [a,b]){e.command({type:'pluck',midi:62,decay:8});render(e,.123);}
    a.command({type:'release'});
    assert.deepEqual(render(a,.02),render(b,.02),'release does not alter output trajectory');
    a.command({type:'gesture',midi:69,decay:.18});
    assert.ok(Math.abs(a.processSample()-b.processSample())<.002,'pitch/decay target does not jump sample');
    checkSamples(render(a,.3));
  });
  test(`Slide ${sampleRate}: repeated attacks across varied phases retain headroom and continuity`,()=>{
    for(const time of [.0123,.0217,.0331,.0649,.1133,.2547]) {
      const a=new Engine(sampleRate),b=new Engine(sampleRate);
      for(const e of [a,b]){e.command({type:'pluck',midi:69,decay:8,strength:1});render(e,time);}
      a.command({type:'pluck',midi:69,decay:8,strength:1});
      assert.ok(Math.abs(a.processSample()-b.processSample())<.003,'no attack reset discontinuity');
      for(let i=0;i<15;i++){a.command({type:'pluck',midi:57+(i%13),strength:1,decay:8});checkSamples(render(a,.03));}
    }
  });
  test(`Slide ${sampleRate}: invalid controls, Stop and Reset are bounded`,()=>{
    const e=new Engine(sampleRate);
    e.command({type:'pluck',midi:Infinity,decay:NaN,strength:1e100});checkSamples(render(e,.2));
    e.command({type:'gesture',midi:-1e12,decay:-1});checkSamples(render(e,.2));
    e.command({type:'stop'});assert.ok(render(e,.03).every(x=>x===0));
    e.command({type:'reset'});assert.ok(render(e,.03).every(x=>x===0));
  });
  test(`Slide ${sampleRate}: demo goes through the real engine and ends quietly`,()=>{
    const e=new Engine(sampleRate);let next=0,max=0,lateEnergy=0;
    for(let i=0;i<sampleRate*10;i++){
      while(next<demo.events.length && demo.events[next].at<=i/sampleRate){if(demo.events[next].command)e.command(demo.events[next].command);next++;}
      const v=e.processSample();assert.ok(Number.isFinite(v));max=Math.max(max,Math.abs(v));if(i>sampleRate*9.9)lateEnergy+=v*v;
    }
    assert.ok(max>.2 && max<.75,'demo produces useful bounded signal');
    assert.ok(Math.sqrt(lateEnergy/(sampleRate*.1))<.0001,'demo ends with decayed tail');
  });
}

test('Slide demo timeline is bounded and ordered',()=>{
  assert.ok(demo.duration>=6 && demo.duration<=12);
  for(let i=1;i<demo.events.length;i++) assert.ok(demo.events[i].at>=demo.events[i-1].at);
  assert.ok(demo.events.at(-1).at<=demo.duration);
});
