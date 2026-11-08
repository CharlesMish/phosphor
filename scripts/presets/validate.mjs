import { readFileSync, writeFileSync } from 'node:fs';
import { parseJsonFile, parseSound } from '../../src/lib/synth/sound-file.ts';
import { parseSessionDocument } from '../../src/lib/synth/session-file.ts';
import { auditionId, parsePack, defaultMetadata } from '../../src/lib/synth/preset-pack.ts';
const args=process.argv.slice(2);
try {
 if(args[0]==='--template') {
  const [,namespace,path]=args;if(!namespace||!path)throw new Error('Use --template unique-namespace output.pack.json');
  const sound=parseSound(JSON.parse(readFileSync('contributor-kit/canonical.sound.json','utf8')));
  const roles=['bass','keys','lead','pad','short-note/sequence','wildcard'];
  const entries=roles.map((role,i)=>({id:`${namespace}:sound-0${i+1}`,version:1,metadata:{...defaultMetadata(`Replace example ${i+1}`),contributor:namespace,roles:[role],provenance:'Neutral template. Replace this description and author a new sound.'},sound}));
  writeFileSync(path,JSON.stringify(parsePack({format:'phosphor-preset-pack',version:1,namespace,entries}),null,2)+'\n');
  console.log(`Created ${path}. All six placeholders use the same neutral example; author them before submission.`);
 } else {
  const path=args[0];if(!path)throw new Error('Usage: npm run presets:validate -- file.json [--round1|--round2] [--reveal reveal.json]');
  const input=parseJsonFile(readFileSync(path,'utf8'));
  if(input.format==='phosphor-preset-pack') {
   const pack=parsePack(input);
   if(args.includes('--round1')) {
    const roles=['bass','keys','lead','pad','short-note/sequence','wildcard'];
    if(pack.entries.length!==6||roles.some(r=>!pack.entries.some(e=>e.metadata.roles[0]===r)))throw new Error('Round 1 requires six sounds, with one primary role each: bass, keys, lead, pad, short-note/sequence, wildcard.');
   }
   if(args.includes('--round2')&&pack.entries.length>2)throw new Error('Round 2 allows at most two additions.');
   const reveal=args.indexOf('--reveal');
   if(reveal>=0){if(!args[reveal+1])throw new Error('Supply a reveal filename.');writeFileSync(args[reveal+1],JSON.stringify(Object.fromEntries(pack.entries.map(e=>[auditionId(e.id),{id:e.id,version:e.version,name:e.metadata.name,contributor:e.metadata.contributor}])),null,2)+'\n');}
   console.log(JSON.stringify({status:'schema-valid; not listening approval',namespace:pack.namespace,count:pack.entries.length,ids:pack.entries.map(e=>e.id)},null,2));
  } else if(input.format==='phosphor-session') {parseSessionDocument(input);console.log('Session valid, including v1 migration. Import through Sounds to extract only its sound.');}
  else {parseSound(input);console.log('Sound valid, including v1 migration.');}
 }
} catch(error) {console.error(error.message);process.exitCode=1;}
