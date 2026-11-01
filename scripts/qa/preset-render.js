import packData from '../../src/presets/starter.pack.json';
import { parsePack, auditionId } from '../../src/lib/synth/preset-pack.ts';
import { demoSession } from '../../src/lib/synth/preset-audition.ts';
import { renderPhrase } from '../../src/lib/synth/phrase-render.ts';
import { encodePhraseWav } from '../../src/lib/synth/phrase-export.ts';
import { decodeFloatWav } from '../../src/lib/synth/wav.ts';
import { parseSound } from '../../src/lib/synth/sound-file.ts';
const pack = parsePack(packData);
const checks=[];const measures=[];const wavs={};
const check=(name,ok,detail={})=>{checks.push({name,ok,detail});if(!ok)throw new Error(name);};
function measure(result) {
 const [l,r]=result.channels;let sum=0,mono=0,lr=0,ll=0,rr=0,step=0,tail=0,leading=0;
 for(let i=0;i<l.length;i++) {
  sum+=(l[i]**2+r[i]**2)/2;mono+=((l[i]+r[i])/2)**2;lr+=l[i]*r[i];ll+=l[i]**2;rr+=r[i]**2;
  if(i)step=Math.max(step,Math.abs(l[i]-l[i-1]),Math.abs(r[i]-r[i-1]));
  if(i<.55*result.sampleRate)leading=Math.max(leading,Math.abs(l[i]),Math.abs(r[i]));
  if(i>l.length-.04*result.sampleRate)tail=Math.max(tail,Math.abs(l[i]),Math.abs(r[i]));
 }
 return {peak:result.peak,rms:Math.sqrt(sum/l.length),monoRatio:Math.sqrt(mono/sum),lrCorrelation:lr/Math.sqrt(ll*rr),maxStep:step,leadingPeak:leading,final40msPeak:tail,frames:result.frames,sampleRate:result.sampleRate};
}
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
try {
 for(const entry of pack.entries) {
  const role=entry.metadata.roles[0];const session=demoSession(entry.sound,role,false,100,.72);
  const result=await renderPhrase(session);const m=measure(result);measures.push({id:auditionId(entry.id),role,mode:'static',...m});
  check(`${role}: finite, audible, headroom, leading rest and tail`,result.channels.every(c=>c.every(Number.isFinite))&&m.peak>.01&&m.peak<.85&&m.leadingPeak<1e-6&&m.final40msPeak<.0002,m);
  check(`${role}: mono retains body`,m.monoRatio>.65,m);
  const wav=encodePhraseWav(session,result);const decoded=decodeFloatWav(wav);
  check(`${role}: WAV PCM exact`,result.channels.every((c,ch)=>c.every((v,i)=>v===decoded.channels[ch][i])));
  wavs[`${auditionId(entry.id)}-static.wav`]=base64(wav);
  // Worst practical keyboard chord for this fixture, without per-note normalization.
  const stress=structuredClone(session);stress.output.volume=1;
  stress.noteLoop.events=Array.from({length:12},(_,i)=>[{id:i,type:'on',midi:entry.metadata.range[0]+i,beat:1},{id:i,type:'off',midi:entry.metadata.range[0]+i,beat:5}]).flat();
  const poly=measure(await renderPhrase(stress));measures.push({id:auditionId(entry.id),role,mode:'12-voice-monitor-1',...poly});
  check(`${role}: 12-voice headroom`,poly.peak<.85,poly);
 }
 const pad=pack.entries[3];const session=demoSession(pad.sound,'pad',true,100,.72);
 const moving=await renderPhrase(session);measures.push({id:auditionId(pad.id),role:'pad',mode:'motion',...measure(moving)});
 wavs[`${auditionId(pad.id)}-motion.wav`]=base64(encodePhraseWav(session,moving));
 const restored=parseSound(JSON.parse(JSON.stringify(pad.sound)));
 const rerender=await renderPhrase(demoSession(restored,'pad',true,100,.72));
 check('restored morph/Space/Motion render is sample-identical',moving.channels.every((c,ch)=>c.every((v,i)=>v===rerender.channels[ch][i])));
 const staticPad=await renderPhrase(demoSession(pad.sound,'pad',false,100,.72));
 check('explicit Motion produces a different performance',moving.channels[0].some((v,i)=>Math.abs(v-staticPad.channels[0][i])>.001));
 const bass=demoSession(pack.entries[0].sound,'bass',false,100,.72);
 const a=await renderPhrase(bass);bass.output.trimDb-=6;const b=await renderPhrase(bass);
 check('authored -6 dB trim is used by the production render',Math.abs(b.peak/a.peak-10**(-6/20))<.001,{ratio:b.peak/a.peak});
 const controller=new AbortController();const pending=renderPhrase(bass,{signal:controller.signal,onProgress:p=>{if(p>.1)controller.abort();}});
 let cancelled=false;try{await pending;}catch(e){cancelled=e.name==='AbortError';}
 check('in-flight cancellation resolves without stale audio',cancelled);
 window.__presetQA={checks,measures,wavs};document.title='PRESET_OK';
} catch(error) {window.__presetQA={checks,measures,error:String(error)};document.title='PRESET_FAIL';}
document.querySelector('#result').textContent=JSON.stringify({checks,measures},null,2);
