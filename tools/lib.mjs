// Shared helpers for the parkour-bench tools: paths, arg parsing and a small static server.
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const runsDir = join(root, 'runs');
export const packagesDir = join(root, 'packages');
export const briefDir = join(root, 'brief');
// 'default' is for models that offer no effort setting (e.g. Kimi K2.7 Code).
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'default'];
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// `--key value` and `--flag` pairs; anything else is positional.
export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

export function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function packageDir(slugOrPath) {
  return existsSync(join(slugOrPath, 'manifest.json')) ? resolve(slugOrPath) : join(packagesDir, slugOrPath);
}

export function allManifests() {
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir)
    .map((d) => join(packagesDir, d, 'manifest.json'))
    .filter((p) => existsSync(p))
    .map((p) => readJson(p));
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.ico': 'image/x-icon',
};

// Serves `dir` under `/<prefix>/` on a free localhost port, so builds are tested at a sub-path like the hub uses.
export function serve(prefix, dir) {
  const base = `/${prefix}/`;
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === `/${prefix}`) { res.writeHead(301, { Location: base }); return res.end(); }
    if (!path.startsWith(base)) { res.writeHead(404); return res.end('not found'); }
    let file = normalize(join(dir, path.slice(base.length)));
    if (!file.startsWith(resolve(dir) + sep) && file !== resolve(dir)) { res.writeHead(403); return res.end(); }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}${base}`, close: () => server.close() })));
}
