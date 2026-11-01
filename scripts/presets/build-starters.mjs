// Reproducible small proof bank. This script is deliberately excluded from the neutral kit.
import { writeFileSync } from 'node:fs';
import { createFactorySession } from '../../src/lib/synth/session-apply.ts';
import { soundFromSession, parseSound } from '../../src/lib/synth/sound-file.ts';
import { defaultMetadata, parsePack, auditionId } from '../../src/lib/synth/preset-pack.ts';
import { WAVE_SIZE, normalizeWave } from '../../src/lib/synth/waveform.ts';
import { cycleMorphSamples } from '../../src/lib/synth/engine.ts';
import { generateDrivePreset } from '../../src/lib/synth/drive.ts';
const wave = partials => normalizeWave(Array.from({length: WAVE_SIZE}, (_,i) => partials.reduce((v,[n,a]) => v+a*Math.sin(2*Math.PI*n*i/WAVE_SIZE),0)),.9);
const base = () => {
 const sound = soundFromSession(createFactorySession());
 sound.drive.amount=0; sound.space.mix=0; sound.chorus.mix=0;
 for(const route of Object.values(sound.motion.routes)) route.enabled=false;
 return sound;
};
const entries=[];
function add(role,name,partials,voice,character,extra={}) {
 const sound=base(); sound.cycle.samples=wave(partials); sound.cycle.preset='custom';
 Object.assign(sound.voice,voice);
 const metadata={...defaultMetadata(name), contributor:'Astra foundation', provenance:'Four-sound pipeline proof, 2026-11-01; synthetic PeriodicWave voicing, not acoustic emulation.', roles:[role], tags:[], ...extra};
 Object.assign(metadata.character,character);
 entries.push({id:`foundation:${role}-01`,version:1,metadata,sound}); return entries.at(-1);
}
const bass=add('bass','Rounded foundation',[[1,1],[2,.2],[3,.09]],{attack:.012,release:.13,cutoff:.42,trimDb:-3},{brightness:'dark',body:'full/warm',attack:'rounded',texture:'smooth'}, {range:[28,52],playing:'both',release:'Brief release; a held key sustains.',tryThis:'Play C2–G2 in short pulses, then hold C2 for two beats.',recommendedBpm:100,tags:['warm','round','close']});
bass.sound.drive.curve=generateDrivePreset('soft');bass.sound.drive.preset='soft';bass.sound.drive.amount=.1;
const keys=add('keys','Clear chord keys',[[1,1],[2,.32],[3,.08],[4,.13],[6,.035]],{attack:.018,release:.32,cutoff:.76,trimDb:-3},{brightness:'balanced',body:'full/warm',attack:'rounded',texture:'smooth',space:'room',width:'narrow'}, {range:[48,84],playing:'both',release:'Medium release. Held chords stay level; there is no piano-like decay.',tryThis:'Play C3–E3–G3, lift together, then try a higher inversion.',recommendedBpm:100,tags:['warm','chordal','synthetic']});keys.sound.space.mix=.08;keys.sound.space.seconds=1;
const lead=add('lead','Open reed line',[[1,1],[2,.12],[3,.56],[5,.2],[7,.08]],{attack:.008,release:.18,cutoff:.83,trimDb:-4},{brightness:'bright',body:'rounded',attack:'hard/clicky',texture:'grainy'}, {range:[60,88],playing:'both',release:'Short release with no glide or legato retrigger mode.',tryThis:'Play C4–D4–G4–E4 with clear gaps, then hold the last note.',recommendedBpm:100,tags:['forward','dry','reed-like']});
const pad=add('pad','Slow window',[[1,1],[2,.1],[3,.18]],{attack:.55,release:1.3,cutoff:.55,trimDb:-4},{brightness:'dark',body:'full/warm',attack:'soft',texture:'smooth',motion:'slowly evolving',space:'room',width:'wide'}, {range:[48,79],playing:'sustained',release:'Long release and modest Space tail.',tryThis:'Hold C3–G3–D4. Compare Static demo with Motion demo; then start Motion for free playing.',recommendedBpm:80,tags:['warm','moving','gentle']});
pad.sound.cycle.slotA=pad.sound.cycle.samples.slice();pad.sound.cycle.slotB=wave([[1,1],[2,.28],[3,.5],[5,.16]]);pad.sound.cycle.morph=.28;pad.sound.cycle.morphLive=true;pad.sound.cycle.samples=cycleMorphSamples(pad.sound.cycle.slotA,pad.sound.cycle.slotB,.28);
pad.sound.chorus.mix=.22;pad.sound.chorus.period=3.2;pad.sound.space.mix=.14;pad.sound.space.seconds=1.6;pad.sound.motion.mode='ping-pong';pad.sound.motion.beats=8;pad.sound.motion.routes.cycle.enabled=true;
const pack=parsePack({format:'phosphor-preset-pack',version:1,namespace:'foundation',entries});
writeFileSync('src/presets/starter.pack.json',JSON.stringify(pack,null,2)+'\n');
writeFileSync('contributor-kit/starter-reveal.json',JSON.stringify(Object.fromEntries(entries.map(e=>[auditionId(e.id),{id:e.id,name:e.metadata.name,contributor:e.metadata.contributor}])),null,2)+'\n');
const example=base();example.cycle.preset='custom';example.cycle.samples=wave([[1,1],[2,.15]]);example.voice.trimDb=-3;
writeFileSync('contributor-kit/canonical.sound.json',JSON.stringify(parseSound(example),null,2)+'\n');
