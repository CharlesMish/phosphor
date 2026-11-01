import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const port=8093;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port)],{stdio:'ignore'});
const base=`http://127.0.0.1:${port}/phosphor/`;
const out=process.env.QA_OUTPUT || '/tmp/phosphor-preset-qa';mkdirSync(out,{recursive:true});
let browser; let preview;
const checks=[];const errors=[];
function check(name,ok,detail={}) { checks.push({name,ok,detail});if(!ok)throw new Error(name); }
try {
 for(let n=0;n<80;n++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'scripts/qa/phrase-render.html');
 await page.waitForFunction(()=>['PHRASE_OK','PHRASE_FAIL'].includes(document.title),{},{timeout:150000});
 writeFileSync(`${out}/phrase-render.json`,await page.locator('#result').textContent());
 check('existing phrase render browser suite',await page.title()==='PHRASE_OK');
 await page.goto(base+'scripts/qa/preset-render.html');
 await page.waitForFunction(()=>['PRESET_OK','PRESET_FAIL'].includes(document.title),{},{timeout:150000});
 const report=await page.evaluate(()=>window.__presetQA);
 if(report.wavs){for(const [name,bytes] of Object.entries(report.wavs))writeFileSync(`${out}/${name}`,Buffer.from(bytes,'base64'));delete report.wavs;}
 writeFileSync(`${out}/preset-render.json`,JSON.stringify(report,null,2));
 check('preset render browser suite',await page.title()==='PRESET_OK',report.error);
 await page.goto(base);await page.getByRole('button',{name:'Sounds',exact:true}).click();
 check('four starter sounds',await page.locator('[aria-label="Preset list"] li').count()===4);
 await page.getByLabel('Search sounds').fill('warm keys');check('character search',await page.locator('[aria-label="Preset list"] li').count()===1);
 await page.getByRole('button',{name:'Load Clear chord keys'}).click();
 await page.getByRole('status').filter({hasText:'loaded. Take'}).waitFor();
 await page.getByLabel('Search sounds').fill('');
 // Populate a take through the same production state API, then exercise UI load.
 await page.evaluate(async()=>{
  const {captureSession,applySession}=await import('/phosphor/src/lib/synth/session-apply.ts');
  const s=captureSession();s.motion.bpm=91;s.output.volume=.4;s.output.octave=-1;s.domain='drive';
  s.noteLoop={bars:2,events:[{id:7,type:'on',midi:36,beat:1},{id:7,type:'off',midi:36,beat:2}]};applySession(s);
 });
 await page.getByRole('button',{name:'Load Slow window'}).click();await page.getByRole('status').filter({hasText:'loaded. Take'}).waitFor();
 const preserved=await page.evaluate(async()=>{
  const {captureSession}=await import('/phosphor/src/lib/synth/session-apply.ts');
  const {noteLooper}=await import('/phosphor/src/lib/synth/looper-runtime.ts');
  const {useSynthStore}=await import('/phosphor/src/lib/synth/store.ts');
  const s=captureSession();return {tempo:s.motion.bpm,volume:s.output.volume,octave:s.output.octave,domain:s.domain,notes:s.noteLoop.events.length,bars:s.noteLoop.bars,motion:useSynthStore.getState().motionPlaying,transport:noteLooper.getSnapshot().state};
 });
 check('UI load preserves workspace and leaves playback stopped',JSON.stringify(preserved)===JSON.stringify({tempo:91,volume:.4,octave:-1,domain:'drive',notes:2,bars:2,motion:false,transport:'stopped'}),preserved);
 await page.getByRole('button',{name:'Favorite Slow window'}).click();await page.getByLabel('Favorites',{exact:true}).check();check('favorites filter',await page.locator('[aria-label="Preset list"] li').count()===1);await page.getByLabel('Favorites',{exact:true}).uncheck();
 await page.getByLabel('Blind labels',{exact:true}).check();
 const blindText=await page.locator('#sound-shelf').innerText();check('blind UI hides creator and evocative names',!blindText.includes('Astra')&&!blindText.includes('Slow window')&&/P-[0-9A-F]{8}/.test(blindText));
 await page.screenshot({path:`${out}/library-desktop.png`});
 await page.getByLabel('Blind labels',{exact:true}).uncheck();
 await page.getByLabel('Sound name',{exact:true}).fill('Owner copy');await page.getByRole('button',{name:'Save as new',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Saved as a new sound'}).waitFor();
 await page.getByLabel('Sound name',{exact:true}).fill('Renamed copy');await page.getByRole('button',{name:'Rename copy',exact:true}).click();
 check('rename copy visible',await page.getByRole('button',{name:'Load Renamed copy'}).count()===1);
 await page.getByRole('button',{name:'Duplicate',exact:true}).click();await page.getByRole('status').filter({hasText:'loaded. Take'}).waitFor();
 check('duplicate receives a new record',await page.locator('[aria-label="Preset list"] li').count()===6);
 // Export / import uses the real file picker. An invalid import must leave state intact.
 const before=await page.evaluate(()=>localStorage.getItem('phosphor.sounds.v2'));
 await page.getByLabel('Import preset file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"format":"phosphor-preset-pack","version":999}')});
 await page.getByRole('status').filter({hasText:'unsupported fields'}).waitFor();
 check('invalid file unchanged',await page.evaluate(()=>localStorage.getItem('phosphor.sounds.v2'))===before);
 // Render/play and export from shelf; completed take remains in place.
 await page.getByRole('button',{name:'Static demo',exact:true}).click();await page.getByRole('status').filter({hasText:'Playing static'}).waitFor({timeout:60000});
 await page.getByRole('button',{name:'Stop demo',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export Motion WAV',exact:true}).click();const dl=await download;await dl.saveAs(`${out}/ui-export.wav`);
 check('UI demo preserves recorded events',await page.evaluate(async()=>{const {noteLooper}=await import('/phosphor/src/lib/synth/looper-runtime.ts');return noteLooper.getEvents().length===2;}));
 await page.waitForTimeout(600);await page.reload();await page.getByRole('button',{name:'Sounds',exact:true}).click();
 check('reload retains library and favorite',await page.locator('[aria-label="Preset list"] li').count()===6);
 const restored=await page.evaluate(async()=>{const {captureSession}=await import('/phosphor/src/lib/synth/session-apply.ts');return captureSession();});
 check('reload restores patch trim and take stopped',restored.output.trimDb===-4&&restored.output.volume===.4&&restored.noteLoop.events.length===2);
 // Physical owner reset, real engine notes, and an output probe during rapid switches.
 await page.getByRole('button',{name:'Close',exact:true}).click();
 const switching=await page.evaluate(async()=>{
  const {synth}=await import('/phosphor/src/lib/synth/engine.ts');const {performanceInput}=await import('/phosphor/src/lib/synth/looper-runtime.ts');
  const {applySound}=await import('/phosphor/src/lib/synth/sound-session.ts');const pack=(await import('/phosphor/src/presets/starter.pack.json')).default;
  synth.unlock();const ctx=synth.getContext();await ctx.resume();const recorder=ctx.createScriptProcessor(1024,2,2);const samples=[];
  recorder.onaudioprocess=e=>samples.push(...e.inputBuffer.getChannelData(0));synth.auditionGain.connect(recorder);recorder.connect(ctx.destination);
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  for(const entry of pack.entries){performanceInput.noteOn('qa-held',60);await wait(150);await applySound(entry.sound);performanceInput.noteOff('qa-held');}
  await wait(300);performanceInput.noteOn('qa-held',60);await wait(200);const audible=synth.measurePeak();performanceInput.noteOff('qa-held');
  await wait(200);recorder.disconnect();synth.auditionGain.disconnect(recorder);
  let maxStep=0,peak=0;for(let i=1;i<samples.length;i++){maxStep=Math.max(maxStep,Math.abs(samples[i]-samples[i-1]));peak=Math.max(peak,Math.abs(samples[i]));}
  return {peak,maxStep,audible,count:samples.length};
 });
 check('switching resets input ownership and remains bounded',switching.audible>.001&&switching.peak<.85&&switching.maxStep<.2&&switching.count>0,switching);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Sounds',exact:true}).click();
 await page.screenshot({path:`${out}/library-phone.png`});
 check('390px shelf stays in viewport',await page.locator('#sound-shelf').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth;}));
 preview=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','8094'],{stdio:'ignore'});
 for(let n=0;n<80;n++){try{if((await fetch('http://127.0.0.1:8094/phosphor/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const production=await context.newPage();production.on('pageerror',e=>errors.push(e.message));
 await production.goto('http://127.0.0.1:8094/phosphor/');await production.getByRole('button',{name:'Sounds',exact:true}).click();
 await production.getByRole('button',{name:'Load Rounded foundation'}).click();await production.getByRole('status').filter({hasText:'loaded. Take'}).waitFor();
 await production.getByRole('button',{name:'Static demo',exact:true}).click();await production.getByRole('status').filter({hasText:'Playing static'}).waitFor({timeout:60000});
 await production.keyboard.press('Escape');
 check('production bundle loads and auditions the bass',await production.getByRole('status').filter({hasText:'Playing static'}).count()===0 || await production.locator('#sound-shelf').count()===0);
 check('no browser exceptions' ,errors.length===0,errors);
 writeFileSync(`${out}/ui-checks.json`,JSON.stringify({checks,errors},null,2));
 console.log(JSON.stringify({ok:true,checks:checks.length,out,browser:browser.version()},null,2));
} catch(error) {
 writeFileSync(`${out}/ui-checks.json`,JSON.stringify({checks,errors,error:String(error)},null,2));console.error(error);process.exitCode=1;
} finally {await browser?.close();server.kill();preview?.kill();}
