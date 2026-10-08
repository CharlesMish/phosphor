import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../../public/string-lab/experiments/bow/engine.mjs';
import { demo } from '../../public/string-lab/experiments/bow/view.mjs';

const rms = values => Math.sqrt(values.reduce((s,x)=>s+x*x,0)/values.length);
function render(engine,seconds,{speed=.5,roughness=.4,active=true,refresh=true}={}) {
  const n=Math.round(seconds*engine.sampleRate),samples=new Float64Array(n);
  const interval=Math.round(.055*engine.sampleRate);
  for(let i=0;i<n;i++) {
    if(refresh&&i%interval===0) engine.command({type:'bow',speed,roughness,active});
    samples[i]=engine.processSample();
    assert.ok(Number.isFinite(samples[i]),'every sample finite');
    assert.ok(Math.abs(samples[i])<.8,'headroom retained');
  }
  return samples;
}
function harmonicMagnitude(samples,sr,harmonic) {
  let re=0,im=0;
  for(let i=0;i<samples.length;i++) {
    const phase=2*Math.PI*220*harmonic*i/sr;
    re+=samples[i]*Math.cos(phase);im+=samples[i]*Math.sin(phase);
  }
  return Math.hypot(re,im)*2/samples.length;
}

for(const sr of [44100,48000]) {
  test(`bow ${sr}: movement has a useful quiet, medium, and strong range`,()=>{
    const results=[];
    for(const speed of [.08,.4,.9]) {
      const samples=render(new Engine(sr),1.2,{speed});
      results.push(rms(samples.slice(Math.round(sr*.65))));
    }
    assert.ok(results[0]>.012,'slow movement audibly excites the resonator');
    assert.ok(results[1]>results[0]*2,'middle is materially stronger than slow');
    assert.ok(results[2]>results[1]*1.35,'strong remains above the useful middle');
    assert.ok(results[2]<.3,'strong has conservative listening headroom');
  });

  test(`bow ${sr}: grain changes harmonic balance beyond loudness`,()=>{
    const spectra=[];
    for(const roughness of [0,1]) {
      const wave=render(new Engine(sr),1.5,{speed:.5,roughness}).slice(sr);
      const low=harmonicMagnitude(wave,sr,1);
      const high=[4,5,6,7].reduce((sum,k)=>sum+harmonicMagnitude(wave,sr,k)**2,0);
      spectra.push(Math.sqrt(high)/low);
    }
    assert.ok(spectra[1]>spectra[0]*2.5,`rough/silk spectral ratios ${spectra}`);
  });

  test(`bow ${sr}: rest and release dissipate energy, with no resurrected tail`,()=>{
    for(const active of [true,false]) {
      const engine=new Engine(sr);
      const sustained=render(engine,1.1,{speed:.7});
      const resting=render(engine,3.8,{speed:0,active});
      const before=rms(sustained.slice(-Math.round(sr*.15)));
      const tail=rms(resting.slice(0,Math.round(sr*.15)));
      const later=rms(resting.slice(Math.round(sr*1.8),Math.round(sr*2.1)));
      const end=rms(resting.slice(-Math.round(sr*.3)));
      assert.ok(tail>before*.5,'release keeps a resonant tail instead of gating');
      assert.ok(later<before*.05,'stationary contact stops energy injection');
      assert.ok(end<before*.002,'the remaining tail tends toward silence');
      const after=render(engine,.5,{speed:0,active:false});
      assert.ok(rms(after)<end,'removing contact does not resurrect spent energy');
    }
  });

  test(`bow ${sr}: lost movement stream cannot leave a drone`,()=>{
    const engine=new Engine(sr);
    render(engine,1,{speed:.9,roughness:1});
    const abandoned=render(engine,4,{refresh:false});
    assert.ok(rms(abandoned.slice(0,Math.round(sr*.1)))>.02);
    assert.ok(rms(abandoned.slice(-Math.round(sr*.25)))<.0004,
      'DSP independently abandons stale energy controls');
  });

  test(`bow ${sr}: default/rest silent, malformed input bounded, stop/reset silent`,()=>{
    const engine=new Engine(sr);
    assert.equal(rms(render(engine,.1,{refresh:false})),0);
    for(const bad of [NaN,Infinity,-Infinity,-100,100,'loud',null]) {
      engine.command({type:'bow',active:true,speed:bad,roughness:bad});
      render(engine,.03,{refresh:false});
    }
    render(engine,.7,{speed:1,roughness:1});
    engine.command({type:'stop'});
    assert.equal(rms(render(engine,.1,{refresh:false})),0);
    render(engine,.7,{speed:1,roughness:1});
    engine.command({type:'reset'});
    assert.equal(rms(render(engine,.1,{refresh:false})),0);
  });

  test(`bow ${sr}: demo uses the real controls and finishes with a fading tail`,()=>{
    const engine=new Engine(sr);
    const samples=new Float64Array(Math.round(demo.duration*sr));
    let next=0;
    for(let i=0;i<samples.length;i++) {
      while(next<demo.events.length&&demo.events[next].at<=i/sr) {
        if(demo.events[next].command)engine.command(demo.events[next].command);
        next++;
      }
      samples[i]=engine.processSample();
      assert.ok(Number.isFinite(samples[i])&&Math.abs(samples[i])<.8);
    }
    const slow=rms(samples.slice(Math.round(sr*.8),Math.round(sr*1.7)));
    const strong=rms(samples.slice(Math.round(sr*4.5),Math.round(sr*5.7)));
    const end=rms(samples.slice(-Math.round(sr*.3)));
    assert.ok(strong>slow*2,'demo conveys obvious movement energy difference');
    assert.ok(end<strong*.003,'demo ends without a sustained drone');
    assert.equal(next,demo.events.length);
  });
}
