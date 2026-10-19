// Builds a finished run into packages/<slug>/: dist (relative base), source, screenshots,
// thumbnail and manifest.json. Safe to re-run after a fix round; fix history is kept.
//   node tools/package-run.mjs --slug luna-max --family GPT-6-Luna --model gpt-6-luna --provider codex \
//     --effort max --title "Rooftop Flow" --blurb "..." [--start "start run"] [--status partial] \
//     [--storage-keys "a,b"] [--notes "..."]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { allManifests, briefDir, EFFORTS, fail, packagesDir, parseArgs, readJson, runsDir, serve, SLUG } from './lib.mjs';
import { shoot } from './shoot.mjs';

const args = parseArgs();
for (const k of ['slug', 'family', 'model', 'provider', 'effort', 'title', 'blurb']) {
  if (typeof args[k] !== 'string') fail(`--${k} is required`);
}
const { slug } = args;
if (!SLUG.test(slug)) fail(`bad slug "${slug}"`);
if (!EFFORTS.includes(args.effort)) fail(`--effort must be one of ${EFFORTS.join(', ')}`);
if (args.blurb.length > 90) fail(`--blurb is ${args.blurb.length} characters; keep it to 90`);

const runDir = join(runsDir, slug);
const pkgDir = join(packagesDir, slug);
if (!existsSync(join(runDir, 'package.json'))) fail(`runs/${slug} has no package.json - has the model finished?`);
const node = (script, scriptArgs, opts = {}) =>
  spawnSync(process.execPath, [script, ...scriptArgs], { cwd: runDir, stdio: 'inherit', ...opts });

// 1. Dependencies, then an optional typecheck (recorded, not fatal).
if (!existsSync(join(runDir, 'node_modules'))) {
  console.log('installing dependencies...');
  // One command string: npm is a .cmd shim on Windows, which needs a shell.
  const npm = spawnSync('npm install --no-audit --no-fund', { cwd: runDir, stdio: 'inherit', shell: true });
  if (npm.status !== 0) fail('npm install failed');
}
const tsc = join(runDir, 'node_modules', 'typescript', 'bin', 'tsc');
let typecheck = 'skipped';
if (existsSync(tsc) && existsSync(join(runDir, 'tsconfig.json'))) {
  typecheck = node(tsc, ['--noEmit'], { stdio: 'pipe' }).status === 0 ? 'pass' : 'fail';
}
console.log(`typecheck: ${typecheck}`);

// 2. Build with a relative base so the package works at any sub-path. Spawned without a shell:
//    Git Bash would rewrite a leading-slash --base argument into a Windows path.
const vite = join(runDir, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(vite)) fail(`runs/${slug} has no local Vite - the hub only ingests Vite builds`);
const previous = existsSync(join(pkgDir, 'manifest.json')) ? readJson(join(pkgDir, 'manifest.json')) : null;
for (const d of ['dist', 'source', 'screenshots']) rmSync(join(pkgDir, d), { recursive: true, force: true });
mkdirSync(pkgDir, { recursive: true });
const build = node(vite, ['build', '--base', './', '--outDir', join(pkgDir, 'dist'), '--emptyOutDir', '--logLevel', 'warn']);
const built = build.status === 0 && existsSync(join(pkgDir, 'dist', 'index.html'));
rmSync(join(pkgDir, 'dist', '_headers'), { force: true });

// 3. Source, minus dependencies, build output and the brief itself (the brief lives in brief/).
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'reference', '.vite']);
const SKIP_FILES = new Set(['prompt.txt']);
cpSync(runDir, join(pkgDir, 'source'), {
  recursive: true,
  filter: (src) => {
    const name = basename(src);
    if (src === runDir) return true;
    if (statSync(src).isDirectory()) return !SKIP_DIRS.has(name);
    return !SKIP_FILES.has(name) && !name.endsWith('.tsbuildinfo');
  },
});

// 4. localStorage keys: literal keys passed to localStorage, plus string constants named *key* in files that use it.
function storageKeys() {
  if (typeof args['storage-keys'] === 'string') return args['storage-keys'].split(',').map((s) => s.trim()).filter(Boolean);
  const keys = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.html'].includes(extname(name))) continue;
      const text = readFileSync(p, 'utf8');
      if (!text.includes('localStorage')) continue;
      for (const m of text.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*(['"`])([^'"`$]+)\1/g)) keys.add(m[2]);
      for (const m of text.matchAll(/\b\w*key\w*\s*[:=]\s*(['"`])([A-Za-z][\w.:-]{3,})\1/gi)) {
        if (/[-.:_]/.test(m[2]) && !/^(Key|Digit|Arrow|Shift|Control|Alt|Meta|Space)/.test(m[2])) keys.add(m[2]);
      }
    }
  };
  walk(join(pkgDir, 'source'));
  return [...keys].sort();
}
const keys = storageKeys();
const clashes = allManifests()
  .filter((m) => m.slug !== slug)
  .flatMap((m) => m.storageKeys.filter((k) => keys.includes(k)).map((k) => `${k} (also used by ${m.slug})`));

// 5. Serve the build under a sub-path, drive it, and make the thumbnail from the menu.
let shots = { pageErrors: [], consoleErrors: [], replacementChars: 0, frames: [], startButton: false };
if (built) {
  const server = await serve(slug, join(pkgDir, 'dist'));
  try {
    shots = await shoot({ url: server.url, outDir: join(pkgDir, 'screenshots'), start: args.start });
  } finally {
    server.close();
  }
  if (shots.frames.includes('menu.png')) {
    const ff = spawnSync(process.env.FFMPEG ?? 'ffmpeg', ['-v', 'error', '-y', '-i', join(pkgDir, 'screenshots', 'menu.png'),
      '-vf', 'scale=640:360:flags=lanczos', '-c:v', 'libwebp', '-quality', '75', join(pkgDir, 'thumbnail.webp')], { stdio: 'inherit' });
    if (ff.status !== 0) console.warn('warning: ffmpeg failed - set FFMPEG to its path; no thumbnail written');
  }
}

// 6. Manifest. A rebuild resets the visual verdict (the build changed) but keeps fix history.
const manifest = {
  schemaVersion: 1,
  slug,
  title: args.title,
  blurb: args.blurb,
  model: { family: args.family, id: args.model, provider: args.provider, effort: args.effort },
  status: built ? (args.status ?? 'complete') : 'failed',
  brief: { file: 'brief/prompt.txt', sha256: createHash('sha256').update(readFileSync(join(briefDir, 'prompt.txt'))).digest('hex') },
  createdAt: new Date().toISOString(),
  entry: 'dist/index.html',
  thumbnail: 'thumbnail.webp',
  storageKeys: keys,
  build: { command: 'vite build --base ./', ok: built, typecheck },
  verification: {
    pageErrors: shots.pageErrors,
    replacementChars: shots.replacementChars,
    grounded: null,
    moves: null,
    notes: '',
  },
  fixRounds: previous?.fixRounds ?? [],
  notes: typeof args.notes === 'string' ? args.notes : (previous?.notes ?? ''),
};
writeFileSync(join(pkgDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`\npackaged ${slug} -> packages/${slug}`);
console.log(`  build ${built ? 'ok' : 'FAILED'}, typecheck ${typecheck}, start button ${shots.startButton ? 'found' : 'NOT FOUND (pass --start)'}`);
console.log(`  page errors ${shots.pageErrors.length}, console errors ${shots.consoleErrors.length}, mis-encoded chars ${shots.replacementChars}`);
for (const e of [...shots.pageErrors, ...shots.consoleErrors].slice(0, 5)) console.log(`    ${e}`);
console.log(`  storage keys: ${keys.join(', ') || '(none found)'}`);
if (clashes.length) console.log(`  STORAGE KEY CLASH: ${clashes.join('; ')}`);
console.log(`  screenshots: packages/${slug}/screenshots/ (${shots.frames.join(', ')})`);
console.log(`next: look at the screenshots, then node tools/verdict.mjs ${slug} --grounded <bool> --moves <bool> --notes "..."`);
