import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { applySession, captureSession, createFactorySession, restoreLocalSession } from "./session-apply.ts";
import { parseSessionDocument, SESSION_STORAGE_KEY } from "./session-file.ts";
import { parseSound, parseJsonFile, soundFromSession, soundToSession } from "./sound-file.ts";
import { snapshotSound } from "./legacy-sound.ts";
import { applySound, captureSound } from "./sound-session.ts";
import { auditionId, matchesPreset, parsePack, defaultMetadata } from "./preset-pack.ts";
import { SoundLibrary, SOUND_LIBRARY_KEY, LEGACY_LIBRARY_KEY, createSoundId } from "./sound-library.ts";
import { noteLooper, performanceInput } from "./looper-runtime.ts";
import { useSynthStore } from "./store.ts";
import { synth, cycleMorphSamples } from "./engine.ts";
import { demoSession } from "./preset-audition.ts";
import { scheduledNotes } from "./phrase-render.ts";
const pack = parsePack(JSON.parse(readFileSync(new URL('../../presets/starter.pack.json', import.meta.url), 'utf8')));
const clone = <T>(x: T): T => structuredClone(x);
function memory() {
 const map = new Map<string,string>();
 return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k,v); }, removeItem: (k: string) => { map.delete(k); } };
}
it('round-trips all four canonical sounds and rejects hidden DSP fields', () => {
 for (const entry of pack.entries) {
  const sound = parseSound(JSON.parse(JSON.stringify(entry.sound)));
  assert.deepEqual(sound, entry.sound);
  assert.deepEqual(soundFromSession(soundToSession(sound,createFactorySession())), sound);
 }
 const bad: Array<(v: any) => void> = [
  v => v.engine='fm-1', v => v.version=99, v => v.normalization='normalize-blend',
  v => v.voice.decay=.1, v => v.voice.volume=.3, v => v.motion.bpm=100,
  v => v.cycle.samples[0]=NaN, v => v.cycle.samples[0]=Infinity,
  v => v.cycle.samples.pop(), v => v.space.seed=-1, v => v.voice.trimDb=1,
  v => v.motion.routes.pitch={enabled:true}, v => v.motion.routes.cycle.from=0,
  v => v.cycle.samples[0]+=0.01, v => v.cycle.slotB=null,
 ];
 for (const change of bad) { const v=clone(pack.entries[3].sound);change(v);assert.throws(()=>parseSound(v)); }
 const incomplete=clone(pack.entries[0].sound);incomplete.motion.routes.cycle.enabled=true;
 assert.throws(()=>parseSound(incomplete),/requires both/);
 assert.throws(()=>parseJsonFile(' '.repeat(4_000_001)));
});
it('migrates PR 15 raw endpoints and tempo recommendation without re-normalizing the blend', () => {
 applySession(createFactorySession());
 const legacy=snapshotSound(useSynthStore.getState(),'Old');
 legacy.cycle.slotA=legacy.cycle.samples.map(v=>v*.12);
 legacy.cycle.slotB=legacy.cycle.samples.map(v=>-v*.7);
 legacy.cycle.morph=.5;legacy.cycle.morphLive=true;
 const sound=parseSound(legacy);
 assert.deepEqual(sound.cycle.slotA,legacy.cycle.slotA);
 assert.deepEqual(sound.cycle.samples,cycleMorphSamples(legacy.cycle.slotA,legacy.cycle.slotB,.5));
 assert.ok(Math.max(...sound.cycle.samples.map(Math.abs))<1e-6);
 assert.equal(sound.voice.trimDb,0);
 assert.equal('bpm' in sound.motion,false);assert.equal('volume' in sound.voice,false);
 assert.throws(()=>parseSound({...legacy, fm: {amount:1}}));
});
it('migrates both earlier workspace keys while retaining their original bytes', () => {
 const store=memory(); const old:any=createFactorySession();old.version=1;delete old.output.trimDb;
 old.output.volume=.31;old.motion.bpm=83;
 const original=JSON.stringify(old);store.setItem('phosphor.session.v1',original);
 assert.equal(restoreLocalSession(store),'migrated');assert.equal(captureSession().output.trimDb,0);
 assert.equal(captureSession().output.volume,.31);assert.equal(store.getItem('phosphor.session.v1'),original);
 const other=memory();const legacy=snapshotSound(useSynthStore.getState(),'Old current');
 other.setItem('phosphor.sound.current.v1',JSON.stringify(legacy));
 assert.equal(restoreLocalSession(other),'migrated');assert.equal(captureSession().motion.bpm,83);
 assert.equal(other.getItem(SESSION_STORAGE_KEY),null);
 const bad=clone(old);bad.noteLoop.events=[{id:1,type:'on',midi:60,beat:0},{id:1,type:'off',midi:61,beat:1}];
 assert.throws(()=>parseSessionDocument(bad));
 applySession(createFactorySession());
});
it('sound switches retain take, tempo, monitor, octave, editor; no automatic playback and no stale key ownership', async () => {
 const workspace=createFactorySession();workspace.motion.bpm=87;workspace.output.volume=.29;workspace.output.octave=-1;workspace.domain='space';
 workspace.noteLoop={bars:2,events:[{id:2,type:'on',midi:36,beat:1},{id:2,type:'off',midi:36,beat:3}]};
 applySession(workspace);
 let resets=0;const unsubscribe=performanceInput.onReset(()=>resets++);
 let params:any;const original=synth.setParams.bind(synth);
 synth.setParams=(value)=>{params=value;original(value);};
 try {
  await applySound(pack.entries[3].sound);
  assert.deepEqual(noteLooper.completedTake(),workspace.noteLoop);
  const after=captureSession();assert.equal(after.motion.bpm,87);assert.equal(after.output.volume,.29);
  assert.equal(after.output.octave,-1);assert.equal(after.domain,'space');
  assert.equal(noteLooper.getSnapshot().state,'stopped');assert.equal(useSynthStore.getState().motionPlaying,false);
  assert.ok(resets>=1);assert.equal(params.trimDb,pack.entries[3].sound.voice.trimDb);
  assert.deepEqual(captureSound(),pack.entries[3].sound);
  const before=clone(captureSession());
  await assert.rejects(applySound({...pack.entries[0].sound,unknown:true}));assert.deepEqual(captureSession(),before);
 } finally { synth.setParams=original;unsubscribe();applySession(createFactorySession()); }
});
it('refuses sound loading during an in-progress recording before Stop can discard it', async () => {
 const get=noteLooper.getSnapshot; const before=clone(captureSession());let stopped=false;const stop=noteLooper.stop;
 noteLooper.getSnapshot=()=>({...get(),state:'recording'});noteLooper.stop=()=>{stopped=true;};
 try { await assert.rejects(applySound(pack.entries[0].sound),/Finish recording/);assert.equal(stopped,false); }
 finally { noteLooper.getSnapshot=get;noteLooper.stop=stop; }
 assert.deepEqual(captureSession(),before);
});
it('protects factory and contributed originals, supports rename/copies/favorites, and rejects entire conflicting packs', () => {
 const storage=memory();const shelf=new SoundLibrary(storage,pack.entries);
 assert.throws(()=>shelf.rename(pack.entries[0].id,'No'));
 const a=shelf.saveNew(pack.entries[0].sound,defaultMetadata('Same name'));
 const b=shelf.saveNew(pack.entries[0].sound,defaultMetadata('Same name'));assert.notEqual(a.id,b.id);
 shelf.rename(a.id,'Changed');assert.equal(shelf.list().find(r=>r.entry.id===a.id)?.entry.version,2);
 shelf.favorite(a.id);assert.deepEqual(shelf.favorites(),[a.id]);
 const copy=shelf.duplicate(pack.entries[0].id);assert.notEqual(copy.id,pack.entries[0].id);
 const importPack=clone(pack);importPack.namespace='contributor';importPack.entries.forEach(e=>e.id=e.id.replace('foundation:','contributor:'));
 shelf.importPack(importPack);assert.throws(()=>shelf.rename(importPack.entries[0].id,'No'));
 const before=storage.getItem(SOUND_LIBRARY_KEY);assert.throws(()=>shelf.importPack(importPack));assert.equal(storage.getItem(SOUND_LIBRARY_KEY),before);
 const duplicate=clone(pack);duplicate.entries.push(clone(duplicate.entries[0]));assert.throws(()=>parsePack(duplicate));
 const sameSound=clone(pack);sameSound.entries[0].metadata.name='A wholly different story';
 assert.deepEqual(parsePack(sameSound).entries[0].sound,pack.entries[0].sound);
 const reloaded=new SoundLibrary(storage,pack.entries);assert.deepEqual(reloaded.favorites(),[a.id]);
 assert.equal(auditionId(a.id),auditionId(reloaded.exportEntry(a.id).entries[0].id));
});
it('retains old shelf data on migration/quota failure and uses stable migrated IDs', () => {
 const storage=memory();const legacy=snapshotSound(useSynthStore.getState(),'Old');
 const source=JSON.stringify([{id:'old-id',sound:legacy}]);storage.setItem(LEGACY_LIBRARY_KEY,source);
 const shelf=new SoundLibrary(storage,[]);const id=shelf.list()[0].entry.id;
 assert.equal(new SoundLibrary(storage,[]).list()[0].entry.id,id);assert.equal(storage.getItem(LEGACY_LIBRARY_KEY),source);
 const broken=memory();broken.setItem(LEGACY_LIBRARY_KEY,JSON.stringify([{id:'dup',sound:legacy},{id:'dup',sound:legacy}]));
 assert.match(new SoundLibrary(broken,[]).warning,/duplicate/);assert.equal(broken.getItem(SOUND_LIBRARY_KEY),null);
 const full=new SoundLibrary({getItem:()=>null,setItem:()=>{throw new Error('quota');},removeItem:()=>{}},[]);
 assert.throws(()=>full.saveNew(pack.entries[0].sound,defaultMetadata('No')));assert.equal(full.list().length,0);
});
it('blocks all writes after a rejected legacy migration without hiding the original shelf', () => {
 const storage=memory();const legacy=snapshotSound(useSynthStore.getState(),'Old');
 const original=JSON.stringify([{id:'duplicate',sound:legacy},{id:'duplicate',sound:legacy}]);
 storage.setItem(LEGACY_LIBRARY_KEY,original);
 const shelf=new SoundLibrary(storage,pack.entries);
 assert.match(shelf.warning,/duplicate/);
 for(const mutate of [
  ()=>shelf.saveNew(pack.entries[0].sound,defaultMetadata('New')),
  ()=>shelf.duplicate(pack.entries[0].id),
  ()=>shelf.favorite(pack.entries[0].id),
  ()=>shelf.remove('legacy:missing'),
 ]) assert.throws(mutate,/could not be read/);
 assert.equal(storage.getItem(SOUND_LIBRARY_KEY),null);
 assert.equal(storage.getItem(LEGACY_LIBRARY_KEY),original);
 assert.equal(shelf.list().length,4);
 assert.equal(shelf.exportEntry(pack.entries[0].id).entries.length,1);
});
it('allocates namespaced UUIDs without requiring the secure-context randomUUID API', () => {
 const random = { getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
  assert.ok(array instanceof Uint8Array); array.fill(255); return array;
 }};
 assert.equal(createSoundId('local',random),'local:sound-ffffffff-ffff-4fff-bfff-ffffffffffff');
 const ids=Array.from({length:64},()=>createSoundId('imported'));
 assert.equal(new Set(ids).size,64);
 for(const id of ids) assert.match(id,/^imported:sound-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.throws(()=>createSoundId('local',{} as Crypto),/HTTPS or localhost/);
});
it('rejects unsupported saved shelf fields and legacy ID collisions before writing', () => {
 const storage=memory();
 const original=JSON.stringify({entries:[],favorites:[],futureData:{sound:'keep'}});
 storage.setItem(SOUND_LIBRARY_KEY,original);
 const shelf=new SoundLibrary(storage,pack.entries);
 assert.match(shelf.warning,/unsupported/);
 assert.throws(()=>shelf.saveNew(pack.entries[0].sound,defaultMetadata('New')));
 assert.equal(storage.getItem(SOUND_LIBRARY_KEY),original);
 const other=memory();const legacy=snapshotSound(useSynthStore.getState(),'Old');
 other.setItem(LEGACY_LIBRARY_KEY,JSON.stringify([{id:'old-id',sound:legacy}]));
 const collision=clone(pack.entries[0]);collision.id=`legacy:import-${auditionId('old-id').slice(2).toLowerCase()}`;
 const blocked=new SoundLibrary(other,[collision]);
 assert.match(blocked.warning,/Duplicate/);
 assert.equal(other.getItem(SOUND_LIBRARY_KEY),null);
});
it('searches independent character axes and keeps controlled demo timing outside sound data', () => {
 assert.ok(matchesPreset(pack.entries[1],'keys','warm keys'));
 assert.ok(matchesPreset(pack.entries[3],'pad','dark moving pad'));
 assert.equal(matchesPreset(pack.entries[3],'bass',''),false);
 assert.equal(matchesPreset(pack.entries[0],'all','Astra',true),false);
 for (const role of ['bass','keys','lead','pad','short-note/sequence'] as const) {
  const session=demoSession(pack.entries[3].sound,role,false,100);
  assert.equal(scheduledNotes(session)[0].start,.6);
  assert.ok(Object.values(session.motion.routes).every(r=>!r.enabled));
  assert.equal(session.noteLoop.bars,2);
 }
 assert.ok(demoSession(pack.entries[3].sound,'pad',true).motion.routes.cycle.enabled);
});
