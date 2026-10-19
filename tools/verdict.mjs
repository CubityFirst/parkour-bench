// Records the orchestrator's judgement of a package's screenshots, and any fix rounds.
//   node tools/verdict.mjs <slug> [--grounded true|false] [--moves true|false] [--notes "..."]
//                                 [--fix "what was reported back to the model"] [--status complete|partial|failed]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail, packageDir, parseArgs, readJson } from './lib.mjs';

const args = parseArgs();
const [slug] = args._;
if (!slug) fail('usage: node tools/verdict.mjs <slug> [--grounded true|false] [--moves true|false] [--notes ..] [--fix ..] [--status ..]');
const file = join(packageDir(slug), 'manifest.json');
const m = readJson(file);

const bool = (name) => {
  if (args[name] === undefined) return undefined;
  if (args[name] === 'true' || args[name] === true) return true;
  if (args[name] === 'false') return false;
  fail(`--${name} must be true or false`);
};
for (const k of ['grounded', 'moves']) {
  const v = bool(k);
  if (v !== undefined) m.verification[k] = v;
}
if (typeof args.notes === 'string') m.verification.notes = args.notes;
if (typeof args.fix === 'string') m.fixRounds.push({ issue: args.fix, at: new Date().toISOString() });
if (typeof args.status === 'string') {
  if (!['complete', 'partial', 'failed'].includes(args.status)) fail('--status must be complete, partial or failed');
  m.status = args.status;
}
writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
console.log(`${m.slug}: status ${m.status}, grounded ${m.verification.grounded}, moves ${m.verification.moves}, fix rounds ${m.fixRounds.length}`);
