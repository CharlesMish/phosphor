import test from 'node:test';
import assert from 'node:assert/strict';
import {StringVoice} from '../../public/string-lab/shared/string-voice.mjs';
import {AudioHost} from '../../public/string-lab/shared/audio-host.mjs';

const render = (voice, seconds, sr) => {
  const samples = new Float64Array(Math.round(seconds * sr));
  for (let i = 0; i < samples.length; i++) samples[i] = voice.processSample();
  return samples;
};
const rms = (samples) => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
for (const sr of [44100, 48000]) {
  test(`StringVoice stays bounded across rapid retriggers and controls at ${sr}`, () => {
    const voice = new StringVoice(sr);
    for (let n = 0; n < 180; n++) {
      voice.setDamping(n % 4 / 3);
      voice.pluck({frequency: [110, 220, 440, 523.25][n % 4], position: n % 3 / 2, strength: 1, decay: 20});
      const out = render(voice, [0.0003, .003, .017, .13][n % 4], sr);
      assert(out.every(sample => Number.isFinite(sample) && Math.abs(sample) < .781));
    }
    voice.pluck({frequency: NaN, position: Infinity, strength: NaN, decay: Infinity});
    voice.setDamping(NaN); voice.setDecay(NaN);
    assert(render(voice, .3, sr).every(Number.isFinite));
  });
  test(`Retrigger first sample matches uninterrupted voice at varied phases ${sr}`, () => {
    for (const frames of [37, 112, 176, 251, 431, 807, 2390]) {
      const a = new StringVoice(sr), b = new StringVoice(sr);
      a.pluck({frequency: 440, position: .06, strength: 1, decay: 6});
      b.pluck({frequency: 440, position: .06, strength: 1, decay: 6});
      for (let i = 0; i < frames; i++) { a.processSample(); b.processSample(); }
      a.pluck({frequency: 220, position: .5, strength: .7, decay: 4});
      assert(Math.abs(a.processSample() - b.processSample()) < 1e-12, `phase ${frames}`);
    }
  });
  test(`Damping consumes remaining energy and release cannot restore it ${sr}`, () => {
    const open = new StringVoice(sr), caught = new StringVoice(sr);
    for (const voice of [open, caught]) voice.pluck({frequency: 220, position: .4, strength: .8, decay: 8});
    render(open, .18, sr); render(caught, .18, sr);
    caught.setDamping(1);
    const openAfter = render(open, .18, sr), caughtAfter = render(caught, .18, sr);
    assert(rms(caughtAfter.subarray(Math.round(sr * .08))) < rms(openAfter.subarray(Math.round(sr * .08))) * .1);
    caught.setDamping(0);
    assert(rms(render(caught, .2, sr)) < rms(render(open, .2, sr)) * .005);
  });
  test(`Natural decay affects a ringing note; Stop clears energy ${sr}`, () => {
    const long = new StringVoice(sr), short = new StringVoice(sr);
    for (const voice of [long, short]) { voice.pluck({frequency: 220, decay: 8}); render(voice, .1, sr); }
    short.setDecay(.15);
    render(short, .2, sr); render(long, .2, sr);
    assert(rms(render(short, .1, sr)) < rms(render(long, .1, sr)) * .02);
    long.stop(); assert.equal(rms(render(long, .1, sr)), 0);
  });
}

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fakeAudio({moduleGate, resumeGate, failModule = false, autoAck = true} = {}) {
  const contexts = [], nodes = [];
  let moduleFailures = failModule ? 1 : 0;
  class Context {
    constructor() {
      this.state = 'suspended'; this.destination = {}; contexts.push(this);
      this.audioWorklet = {addModule: async () => { if (moduleGate) await moduleGate.promise; if (moduleFailures-- > 0) throw new Error('module failed'); }};
    }
    async resume() { if (resumeGate) await resumeGate.promise; if (this.state !== 'closed') { this.state = 'running'; this.onstatechange?.(); } }
    async suspend() { this.state = 'suspended'; this.onstatechange?.(); }
    async close() { this.state = 'closed'; this.onstatechange?.(); }
  }
  class Node {
    constructor(ctx) {
      this.ctx=ctx; this.messages=[]; nodes.push(this);
      this.port={onmessage:null, close(){}, postMessage: message => {
        this.messages.push(message);
        if (autoAck && message.type === 'select') queueMicrotask(() => this.port.onmessage?.({data:{type:'selected',id:message.id,epoch:message.epoch}}));
      }};
    }
    connect() { this.connected = true; }
    disconnect() { this.connected = false; }
    ack(message = this.messages.findLast(message => message.type === 'select')) { this.port.onmessage?.({data:{type:'selected', id:message.id, epoch:message.epoch}}); }
  }
  const old = {Context:globalThis.AudioContext,Node:globalThis.AudioWorkletNode};
  globalThis.AudioContext=Context; globalThis.AudioWorkletNode=Node;
  return {contexts,nodes,restore(){globalThis.AudioContext=old.Context;globalThis.AudioWorkletNode=old.Node;}};
}

test('Host retry after module failure creates a working context and node', async () => {
  const fake = fakeAudio({failModule:true}); const errors=[];
  const host = new AudioHost({onError:error=>errors.push(error.message)});
  try {
    await assert.rejects(host.enable(), /module failed/);
    assert.equal(host.ready,false); assert.equal(host.state,'error');
    assert.equal(fake.contexts[0].state,'closed'); assert.equal(fake.nodes.length,0);
    assert.equal(await host.enable(),true); assert.equal(host.ready,true);
    assert.equal(fake.contexts.length,2); assert.equal(fake.nodes.length,1); assert.deepEqual(errors,['module failed']);
  } finally { await host.dispose(); fake.restore(); }
});
for (const action of ['stop','suspend','dispose']) {
  test(`Host ${action} during pending module load cannot become ready later`, async () => {
    const gate=deferred(), fake=fakeAudio({moduleGate:gate}); const host=new AudioHost();
    try {
      const enabling=host.enable(); await tick(); await host[action](); gate.resolve();
      assert.equal(await enabling,false); assert.equal(host.ready,false);
      assert.equal(fake.contexts[0].state,'closed'); assert.equal(fake.nodes.length,0);
    } finally { await host.dispose(); fake.restore(); }
  });
}
test('Host Stop during pending resume cannot become ready later', async () => {
  const gate=deferred(), fake=fakeAudio({resumeGate:gate}); const host=new AudioHost();
  try {
    const enabling=host.enable(); await tick(); host.stop(); gate.resolve();
    assert.equal(await enabling,false); assert.equal(host.ready,false); assert.equal(fake.contexts[0].state,'closed');
  } finally { await host.dispose(); fake.restore(); }
});
test('Host latest selection during startup wins and stale acknowledgement is ignored', async () => {
  const fake=fakeAudio({autoAck:false}), host=new AudioHost();
  try {
    const enabling=host.enable(); await tick();
    const node=fake.nodes[0], old=node.messages[0];
    const selecting=host.select('bow'); node.ack(old); assert.equal(host.ready,false);
    node.ack(); assert.equal(await selecting,true); assert.equal(await enabling,true);
    assert.equal(host.selected,'bow'); assert.equal(host.ready,true);
  } finally { await host.dispose(); fake.restore(); }
});
test('Host Stop preserves ready and immediately accepts a fresh attack with new epoch', async () => {
  const fake=fakeAudio(), host=new AudioHost();
  try {
    await host.enable(); host.send({type:'pluck'}); host.stop();
    assert.equal(host.ready,true); assert.equal(host.send({type:'pluck'}),true);
    const messages=fake.nodes[0].messages;
    assert.equal(messages.at(-1).epoch,messages.at(-2).epoch);
    assert(messages.at(-1).epoch > messages.at(-3).epoch);
    await host.select('slide'); assert.equal(host.ready,true); assert.equal(fake.nodes.length,1);
    await host.suspend(); assert.equal(host.ready,false); await host.enable(); assert.equal(host.ready,true); assert.equal(fake.nodes.length,1);
  } finally { await host.dispose(); fake.restore(); }
});

test('Context interruption callback survives suspend/re-enable and clears excitation', async () => {
  const fake=fakeAudio(), host=new AudioHost();
  try {
    await host.enable(); await host.suspend(); await host.enable();
    const ctx=fake.contexts[0], node=fake.nodes[0];
    ctx.state='suspended'; ctx.onstatechange();
    assert.equal(host.state,'suspended'); assert.equal(host.ready,false);
    assert.equal(node.messages.at(-1).type,'stop');
    ctx.state='running'; ctx.onstatechange();
    assert.equal(host.state,'on'); assert.equal(host.ready,true);
  } finally { await host.dispose(); fake.restore(); }
});

// Load the real worklet router in Node with only its browser superclass stubbed.
// Engines, fade buffers, sample generation and messages are production code.
let Processor;
for (const sr of [44100, 48000]) {
  test(`Worklet Stop/switch fades output, rejects stale controls, allows new pluck ${sr}`, async () => {
    globalThis.sampleRate=sr;
    globalThis.AudioWorkletProcessor=class { constructor() { this.port={messages:[],postMessage(message){this.messages.push(message);}}; } };
    globalThis.registerProcessor=()=>{};
    if (!Processor) ({StringLabProcessor:Processor}=await import('../../public/string-lab/worklet.mjs'));
    const processor=new Processor(), continuous=new Processor();
    processor.processSample=()=>processor.sample();
    const configure = p => {
      p.message({type:'select',id:'catch',epoch:1});
      p.message({type:'command',command:{type:'pluck',strength:1,position:.12},epoch:1});
      for (let i=0;i<1121;i++) p.sample();
    };
    configure(processor); configure(continuous);
    processor.message({type:'stop',epoch:2});
    assert.equal(processor.sample(),continuous.sample(),'first stop sample follows existing waveform');
    processor.message({type:'command',command:{type:'pluck',strength:1},epoch:1});
    for (let i=0;i<processor.fadeLength+10;i++) processor.sample();
    assert.equal(processor.sample(),0,'stale attack rejected and fade ends in silence');
    processor.message({type:'command',command:{type:'pluck',strength:.7},epoch:2});
    const before=render(processor,.1,sr);
    assert(rms(before)>.03,'fresh attack accepted without another enable');
    processor.message({type:'select',id:'bow',epoch:3});
    assert.equal(processor.id,'bow');
    for (let i=0;i<processor.fadeLength+10;i++) processor.sample();
    assert.equal(processor.sample(),0,'old mode tail ends and new mode starts silent');
    processor.message({type:'command',command:{type:'bow',active:true,speed:.8,roughness:.5},epoch:3});
    assert(rms(render(processor,.1,sr))>.02);
    processor.message({type:'stop',epoch:4});
    processor.message({type:'command',command:{type:'bow',active:true,speed:1},epoch:3});
    assert(rms(render(processor,.2,sr).subarray(processor.fadeLength))===0);
  });
}
