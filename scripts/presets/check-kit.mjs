// Unpack a contributor kit zip into a temporary folder and check it the way a
// contributor would: typecheck and production build, using this repo's
// installed dependencies (the kit pins the same package-lock.json).
// Usage: npm run presets:kit:check -- [path/to/phosphor-contributor-kit.zip]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const zip = resolve(process.argv[2] || 'review-artifacts/phosphor-contributor-kit.zip');
if (!existsSync(zip)) throw new Error(`No kit archive at ${zip}. Run npm run presets:kit first.`);
const dir = mkdtempSync(join(tmpdir(), 'phosphor-kit-check-'));
try {
  execFileSync('python3', ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, dir]);
  const lockHere = readFileSync('package-lock.json', 'utf8');
  if (readFileSync(join(dir, 'package-lock.json'), 'utf8') !== lockHere) throw new Error('The kit pins a different package-lock.json; run npm ci inside the kit instead.');
  symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
  const run = (script) => { execFileSync('npm', ['run', '-s', script], { cwd: dir, stdio: 'inherit' }); console.log(`kit ${script}: ok`); };
  run('typecheck');
  run('build');
  console.log(JSON.stringify({ archive: zip, checked: ['typecheck', 'build'], ok: true }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
