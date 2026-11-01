import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { defaultMetadata, parsePack } from '../../src/lib/synth/preset-pack.ts';
import { parseSound } from '../../src/lib/synth/sound-file.ts';
const out=resolve(process.argv[2] || 'review-artifacts/phosphor-contributor-kit.zip');
const stage=resolve('/tmp/phosphor-neutral-kit-build');rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true});
const files=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n');
const include=p=>p.startsWith('src/')&&!p.endsWith('.test.ts')&&!p.startsWith('src/presets/') || ['package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','LICENSE','scripts/ts-test-loader.mjs','scripts/presets/validate.mjs'].includes(p) || ['contributor-kit/README.md','contributor-kit/CAPABILITIES.md','contributor-kit/CONTRACT.md','contributor-kit/canonical.sound.json','contributor-kit/demos.json'].includes(p);
const hashes={};
for(const file of files.filter(include)) {
 const target=join(stage,file);mkdirSync(dirname(target),{recursive:true});cpSync(file,target);
 if(file.startsWith('src/lib/synth/')||file==='contributor-kit/demos.json')hashes[file]=createHash('sha256').update(readFileSync(file)).digest('hex');
}
const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
// Require source and dependency files to be committed before sealing the pin.
const trackedChanges=execFileSync('git',['diff','HEAD','--name-only'],{encoding:'utf8'}).trim().split('\n').filter(include);
if(trackedChanges.length)throw new Error(`Commit kit source changes before pinning: ${trackedChanges.join(', ')}`);
const example=parseSound(JSON.parse(readFileSync('contributor-kit/canonical.sound.json','utf8')));
const neutral=parsePack({format:'phosphor-preset-pack',version:1,namespace:'neutral',entries:[{id:'neutral:canonical-example',version:1,metadata:{...defaultMetadata('Neutral technical example'),contributor:'Shared technical kit',provenance:'Same unvoiced starting example for every contributor.',roles:['keys','wildcard']},sound:example}]});
mkdirSync(join(stage,'src/presets'),{recursive:true});writeFileSync(join(stage,'src/presets/starter.pack.json'),JSON.stringify(neutral,null,2)+'\n');
for (const name of ['README.md','CAPABILITIES.md','CONTRACT.md']) cpSync('contributor-kit/'+name,join(stage,name));
const pkg=JSON.parse(readFileSync(join(stage,'package.json'),'utf8'));
pkg.scripts=Object.fromEntries(Object.entries(pkg.scripts).filter(([k])=>['dev','build','preview','typecheck','presets:validate'].includes(k)));
writeFileSync(join(stage,'package.json'),JSON.stringify(pkg,null,2)+'\n');
const revision={format:'phosphor-contributor-kit',version:1,sourceRevision,mainBase:'067b8fd6a39a55d8db6ed85ec5c9088f3519028b',sessionFoundation:'495b2473645a85985cf9b717deca83168a6d1705',engine:'phosphor-periodic-1',soundSchema:2,sessionSchema:2,packSchema:1,sha256:hashes,omitted:['proof bank','proof-bank recipe','other contributor banks','owner reveal mapping','git history']};
writeFileSync(join(stage,'contributor-kit/revision.json'),JSON.stringify(revision,null,2)+'\n');writeFileSync(join(stage,'revision.json'),JSON.stringify(revision,null,2)+'\n');
mkdirSync(dirname(out),{recursive:true});
// Python stdlib produces a portable deterministic archive (no symlinks/dependencies).
execFileSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3',['-c',`import pathlib,zipfile,sys
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(root.rglob('*')):
  if p.is_file():
   i=zipfile.ZipInfo(str(p.relative_to(root)));i.date_time=(2026,11,1,0,0,0);i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=0o644<<16;z.writestr(i,p.read_bytes())`,stage,out]);
writeFileSync(out+'.sha256',createHash('sha256').update(readFileSync(out)).digest('hex')+'  '+out.split('/').pop()+'\n');
console.log(JSON.stringify({archive:out,sourceRevision,staged:stage},null,2));
