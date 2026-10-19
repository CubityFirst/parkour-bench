// Drives a built game in headless Chrome and saves screenshots for the orchestrator to judge.
//   node tools/shoot.mjs --url http://127.0.0.1:5173/ --out <dir> [--start "start|run"]
// Frames: menu.png, idle-500/2000/5000.png (no input after Enter on the start button) and
// sprint-2000/5000.png (W + Shift held). The game is started with the keyboard, not the mouse,
// so no stray mouse movement turns the camera.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './lib.mjs';

const IDLE = [500, 2000, 5000];
const SPRINT = [2000, 5000];
// U+FFFD in visible text means a source file wasn't saved as UTF-8.
const badChars = (page) => page.evaluate(() => (document.body.innerText.match(/�/g) ?? []).length);

export async function shoot({ url, outDir, start = 'start|play|run' }) {
  const { chromium } = await import('playwright-core');
  mkdirSync(outDir, { recursive: true });
  // System Chrome on the real GPU; headless SwiftShader is too slow for these scenes.
  const args = ['--enable-gpu', '--ignore-gpu-blocklist', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])];
  // CHROME points at another Chromium build when Google Chrome isn't installed.
  const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }), headless: true, args });
  const result = { url, pageErrors: [], consoleErrors: [], replacementChars: 0, renderer: null, startButton: false, frames: [] };
  try {
    for (const [name, times, keys] of [['idle', IDLE, []], ['sprint', SPRINT, ['KeyW', 'ShiftLeft']]]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.on('pageerror', (e) => result.pageErrors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/favicon/i.test(m.location()?.url ?? '')) result.consoleErrors.push(m.text());
      });
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(3000);
      if (name === 'idle') {
        await page.screenshot({ path: join(outDir, 'menu.png') });
        result.frames.push('menu.png');
        result.replacementChars = await badChars(page);
        result.renderer = await page.evaluate(() => {
          const c = document.querySelector('canvas');
          const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
          const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
          return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
        });
      }
      const button = page.getByRole('button', { name: new RegExp(start, 'i') }).first();
      if (!(await button.count())) break;
      result.startButton = true;
      await button.focus();
      await page.keyboard.press('Enter');
      for (const k of keys) await page.keyboard.down(k);
      let t = 0;
      for (const at of times) {
        await page.waitForTimeout(at - t);
        t = at;
        const file = `${name}-${at}.png`;
        await page.screenshot({ path: join(outDir, file) });
        result.frames.push(file);
      }
      result.replacementChars = Math.max(result.replacementChars, await badChars(page));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  result.pageErrors = [...new Set(result.pageErrors)];
  result.consoleErrors = [...new Set(result.consoleErrors)];
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs();
  if (!args.url || !args.out) {
    console.error('usage: node tools/shoot.mjs --url <url> --out <dir> [--start "<regex>"]');
    process.exit(1);
  }
  const result = await shoot({ url: args.url, outDir: resolve(args.out), start: args.start });
  console.log(JSON.stringify(result, null, 2));
}
