import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../../public/string-lab/experiments/catch/engine.mjs';
import { demo } from '../../public/string-lab/experiments/catch/view.mjs';

function render(sr, seconds, events) {
  const engine = new Engine(sr);
  const out = new Float64Array(Math.round(sr * seconds));
  const sorted = events.map(e => ({...e, sample: Math.round(e.at * sr)})).sort((a,b) => a.sample - b.sample);
  let j = 0;
  for (let i = 0; i < out.length; i++) {
    while (j < sorted.length && sorted[j].sample <= i) engine.command(sorted[j++].command);
    out[i] = engine.processSample();
  }
  return out;
}
function energy(out, sr, start, end) {
  let sum = 0;
  const first = Math.round(start * sr), last = Math.min(out.length, Math.round(end * sr));
  for (let i = first; i < last; i++) sum += out[i] * out[i];
  return sum / (last - first);
}
const attack = {type:'pluck',strength:.76,position:.38};

for (const sr of [44100,48000]) {
  test(`Catch ${sr}: damping has graded, energy-consuming effect on an existing note`, () => {
    const measures = [0,.06,.2,.78].map(amount => {
      const out = render(sr, 1.2, [
        {at:0,command:attack},
        {at:.25,command:{type:'damp',amount}},
      ]);
      assert.ok(out.every(Number.isFinite));
      assert.ok(out.every(x => Math.abs(x) <= .8));
      return energy(out,sr,.3,1);
    });
    for (let i = 1; i < measures.length; i++) {
      assert.ok(measures[i] < measures[i-1] * .65, `graded effect: ${measures.join(', ')}`);
    }
  });

  test(`Catch ${sr}: lifting damper cannot restore a caught tail`, () => {
    const open = render(sr,2,[{at:0,command:attack}]);
    const caught = render(sr,2,[
      {at:0,command:attack},
      {at:.3,command:{type:'damp',amount:.78}},
      {at:.65,command:{type:'damp',amount:0}},
    ]);
    const restored = energy(caught,sr,.85,1.5);
    assert.ok(restored < energy(open,sr,.85,1.5) * .0001, `caught energy ${restored}`);
    assert.ok(energy(caught,sr,1.1,1.5) <= energy(caught,sr,.7,1.1));
  });

  test(`Catch ${sr}: damper held before attack gives a shorter note, then an open pluck recovers`, () => {
    const open = render(sr,1,[{at:0,command:attack}]);
    const muted = render(sr,1,[{at:0,command:{type:'damp',amount:.72}},{at:0,command:attack}]);
    assert.ok(energy(muted,sr,.005,.035) > 1e-7, 'muted attack still produces sound');
    assert.ok(energy(muted,sr,.1,.3) < energy(open,sr,.1,.3) * .001);
    const released = render(sr,1.5,[
      {at:0,command:{type:'damp',amount:.72}},{at:0,command:attack},
      {at:.5,command:{type:'damp',amount:0}},{at:.7,command:attack},
    ]);
    assert.ok(energy(released,sr,.8,1) > energy(muted,sr,.1,.3) * 100);
  });

  test(`Catch ${sr}: natural decay remains a live control`, () => {
    const long = render(sr,2,[{at:0,command:attack}]);
    const shortened = render(sr,2,[{at:0,command:attack},{at:.3,command:{type:'decay',seconds:.4}}]);
    assert.ok(energy(shortened,sr,.6,1.2) < energy(long,sr,.6,1.2) * .02);
  });

  test(`Catch ${sr}: demo renders bounded, stop/reset silent, hostile controls finite`, () => {
    const out = render(sr,demo.duration,demo.events.filter(e=>e.command));
    assert.ok(out.every(Number.isFinite));
    assert.ok(out.every(x=>Math.abs(x)<.8));
    assert.ok(energy(out,sr,.05,.25)>1e-5);
    const engine = new Engine(sr);
    for (const invalid of [NaN,Infinity,-Infinity,null,undefined,-100,100]) {
      engine.command({type:'pluck',strength:invalid,position:invalid});
      engine.command({type:'decay',seconds:invalid});
      engine.command({type:'damp',amount:invalid});
      for(let i=0;i<200;i++) assert.ok(Number.isFinite(engine.processSample()));
    }
    engine.command({type:'stop'});
    for(let i=0;i<512;i++) assert.equal(engine.processSample(),0);
    engine.command(attack);
    engine.command({type:'reset'});
    for(let i=0;i<512;i++) assert.equal(engine.processSample(),0);
  });
}

test('Catch demo is sorted, bounded, and leaves damping open',()=>{
  assert.ok(demo.duration>=6&&demo.duration<=12);
  assert.ok(demo.events.every((event,index)=>event.at>=0&&event.at<demo.duration&&(!index||event.at>=demo.events[index-1].at)));
  assert.deepEqual(demo.events.filter(e=>e.command?.type==='damp').at(-1).command,{type:'damp',amount:0});
});
