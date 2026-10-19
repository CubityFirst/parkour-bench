// Seeds runs/<slug>/ with the brief and reference images, then prints the exact subagent task.
//   node tools/new-run.mjs <slug>
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { briefDir, fail, packagesDir, parseArgs, runsDir, SLUG } from './lib.mjs';

const [slug] = parseArgs()._;
if (!slug || !SLUG.test(slug)) fail('usage: node tools/new-run.mjs <slug>   (lowercase letters, digits and dashes)');
if (existsSync(join(packagesDir, slug))) fail(`packages/${slug} already exists - pick another slug`);

const runDir = join(runsDir, slug);
mkdirSync(runDir, { recursive: true });
// Re-running is safe: the brief is only copied in if it isn't there yet, so a model's work is never overwritten.
if (!existsSync(join(runDir, 'prompt.txt'))) cpSync(join(briefDir, 'prompt.txt'), join(runDir, 'prompt.txt'));
if (!existsSync(join(runDir, 'reference'))) cpSync(join(briefDir, 'reference'), join(runDir, 'reference'), { recursive: true });

const task = readFileSync(join(briefDir, 'subagent-task.md'), 'utf8').replaceAll('{{RUN_DIR}}', runDir).replaceAll('\\', sep).trim();
console.log(task);
