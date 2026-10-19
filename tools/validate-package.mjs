// Checks packages against PACKAGE.md. Exits non-zero if any package has errors.
//   node tools/validate-package.mjs [<slug|path> ...]     (no arguments: every package)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allManifests, EFFORTS, packageDir, packagesDir, parseArgs, readJson, SLUG } from './lib.mjs';

export function validate(dir, others = []) {
  const errors = [];
  const warnings = [];
  const file = join(dir, 'manifest.json');
  if (!existsSync(file)) return { slug: dir, errors: ['no manifest.json'], warnings };
  let m;
  try { m = readJson(file); } catch (e) { return { slug: dir, errors: [`manifest.json is not valid JSON: ${e.message}`], warnings }; }
  const need = (cond, msg) => { if (!cond) errors.push(msg); };

  need(m.schemaVersion === 1, 'schemaVersion must be 1');
  need(typeof m.slug === 'string' && SLUG.test(m.slug), 'slug must be lowercase letters, digits and dashes');
  need(typeof m.title === 'string' && m.title.length >= 1 && m.title.length <= 40, 'title must be 1-40 characters');
  need(typeof m.blurb === 'string' && m.blurb.length >= 10 && m.blurb.length <= 90, 'blurb must be 10-90 characters');
  need(m.blurb !== 'TBD', 'blurb is a placeholder');
  need(m.model && m.model.family && m.model.id && m.model.provider, 'model needs family, id and provider');
  need(EFFORTS.includes(m.model?.effort), `model.effort must be one of ${EFFORTS.join(', ')}`);
  need(['complete', 'partial', 'failed'].includes(m.status), 'status must be complete, partial or failed');
  need(/^[0-9a-f]{64}$/.test(m.brief?.sha256 ?? ''), 'brief.sha256 missing');
  need(Array.isArray(m.storageKeys), 'storageKeys must be an array');
  need(Array.isArray(m.fixRounds), 'fixRounds must be an array');
  need(m.verification && Array.isArray(m.verification.pageErrors), 'verification.pageErrors missing');

  if (m.status !== 'failed') {
    const index = join(dir, 'dist', 'index.html');
    need(existsSync(index), 'dist/index.html missing');
    need(existsSync(join(dir, 'thumbnail.webp')), 'thumbnail.webp missing');
    if (existsSync(index)) {
      // Root-relative asset URLs break when the hub serves the game at /<slug>/.
      const abs = [...readFileSync(index, 'utf8').matchAll(/\b(?:src|href)="(\/[^/"][^"]*)"/g)].map((x) => x[1]);
      need(abs.length === 0, `dist/index.html uses root-relative URLs (${abs.slice(0, 3).join(', ')}) - build with --base ./`);
    }
    const v = m.verification ?? {};
    need(v.grounded !== null && v.grounded !== undefined, 'verification.grounded not judged yet - run tools/verdict.mjs');
    need(v.moves !== null && v.moves !== undefined, 'verification.moves not judged yet - run tools/verdict.mjs');
    if (m.status === 'complete') {
      need(v.pageErrors?.length === 0, `status is complete but there are page errors: ${v.pageErrors?.[0]}`);
      need(v.replacementChars === 0, `status is complete but ${v.replacementChars} mis-encoded characters render`);
      need(v.grounded !== false && v.moves !== false, 'status is complete but the player cannot stand or move');
    }
    if (m.build?.typecheck === 'fail') warnings.push('typecheck failed (recorded; the build still works)');
  }
  for (const o of others) {
    if (o.slug === m.slug) continue;
    // The hub namespaces each game's localStorage by slug, so a shared key name is harmless there.
    for (const k of m.storageKeys ?? []) if (o.storageKeys?.includes(k)) warnings.push(`storage key "${k}" is also used by ${o.slug} (the hub isolates it per game)`);
    if (o.model?.family === m.model?.family && o.model?.effort === m.model?.effort) {
      warnings.push(`${o.slug} is also ${m.model.family} at ${m.model.effort}; the hub picker shows one per effort`);
    }
  }
  return { slug: m.slug ?? dir, errors, warnings };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const targets = parseArgs()._;
  const dirs = targets.length
    ? targets.map(packageDir)
    : existsSync(packagesDir) ? readdirSync(packagesDir).map((d) => join(packagesDir, d)).filter((d) => existsSync(join(d, 'manifest.json'))) : [];
  const others = allManifests();
  let bad = 0;
  for (const dir of dirs) {
    const { slug, errors, warnings } = validate(dir, others);
    console.log(`${errors.length ? 'FAIL' : 'ok  '} ${slug}`);
    for (const e of errors) console.log(`     error: ${e}`);
    for (const w of warnings) console.log(`     warning: ${w}`);
    if (errors.length) bad++;
  }
  if (!dirs.length) console.log('no packages found');
  process.exit(bad ? 1 : 0);
}
