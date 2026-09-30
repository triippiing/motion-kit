// capture.mjs -- record the finance app's dock pill, old against new.
//
//   node demos/03-finance-inapp/capture.mjs        -> out/dock-springs.mp4
//
// Everything the video shows is read out of the personal-finance repo with
// `git show` at capture time, never copied into this folder: the motion-demo
// branch's style.css, icons.js, springs.js and the dock pill's functions cut
// out of its web/app.js by name, and main's old dockPillStyle(index) plus its
// transition declaration for the top row. So the video always shows the
// committed code, and re-running it after an edit there shows the edit.
//
// Playwright comes from the motion-video skill's node_modules; ffmpeg from
// Homebrew. The same sequence plays twice, in real time and 4x slower:
// 0 -> 3 -> 1 -> 4, then 0 while the pill is still on its way to 4.

import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(
  path.join(HERE, '../../skills/motion-video/node_modules/playwright/index.mjs'));
const FIN = path.join(os.homedir(), 'Documents/AUTOMATION/personal-finance');
const NEW = process.env.FIN_REF || 'motion-demo', OLD = 'main';
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const SIZE = { width: 960, height: 200 };

const show = (ref, file) =>
  execFileSync('git', ['-C', FIN, 'show', `${ref}:${file}`], { encoding: 'utf8', maxBuffer: 1 << 26 });

// A top-level declaration, from its first line to the line that closes it
// at column 0 ("}" for a function, "];" for PAGES, or its own ";" line).
function cut(src, head) {
  const start = src.search(new RegExp('^' + head, 'm'));
  if (start < 0) throw new Error('not found in app.js: ' + head);
  const line = src.slice(start, src.indexOf('\n', start));
  if (/;\s*(\/\/.*)?$/.test(line)) return line;
  const close = src.slice(start).search(/^(\}|\];)$/m);
  return src.slice(start, start + close + src.slice(start + close).indexOf('\n'));
}

const app = show(NEW, 'web/app.js');
const NEW_DECLS = ['const PAGES = \\[', 'function pageIndex\\(', 'function prefersReducedMotion\\(',
  'const DOCK_TRAVEL_SEC = ', 'const DOCK_LEAD = ', 'function dockPillEdges\\(',
  'function dockPillStyle\\(', 'let dockPillMotion = ', 'function moveDockPill\\(', 'function stepDockPill\\('];
const oldApp = show(OLD, 'web/app.js');
const oldStyle = cut(oldApp, 'function dockPillStyle\\(index\\)')
  .replace('function dockPillStyle(', 'function oldDockPillStyle(');
const dockCode = [...NEW_DECLS.map((h) => cut(app, h)), oldStyle].join('\n\n') + '\n';

const oldCss = show(OLD, 'web/style.css');
const oldRule = oldCss.slice(oldCss.indexOf('.dock i[data-dock-pill]{'));
const oldTransition = oldRule.slice(0, oldRule.indexOf('}')).match(/transition:[^;}]+/);
if (!oldTransition) throw new Error("main's dock pill transition not found");
const harness = readFileSync(path.join(HERE, 'harness.html'), 'utf8')
  .replace('/*OLD_TRANSITION*/', oldTransition[0]);

const files = {
  '/': ['text/html', harness],
  '/dock-code.js': ['text/javascript', dockCode],
  '/style.css': ['text/css', show(NEW, 'web/style.css')],
  '/icons.js': ['text/javascript', show(NEW, 'web/icons.js')],
  '/springs.js': ['text/javascript', show(NEW, 'web/springs.js')],
};
const server = createServer((req, res) => {
  const f = files[new URL(req.url, 'http://x').pathname];
  if (!f) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': f[0] }).end(f[1]);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/`;

if (process.argv.includes('--serve')) {
  console.log(`harness at ${base} (?slow=4 to slow it down); ctrl-c to stop`);
} else {
  const out = path.join(HERE, 'out'), raw = path.join(out, 'raw');
  rmSync(raw, { recursive: true, force: true });
  mkdirSync(raw, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir: raw, size: SIZE } });
  const page = await context.newPage();
  const t0 = Date.now();
  const wait = (ms) => page.waitForTimeout(ms);

  let lead = 0;
  for (const slow of [1, 4]) {
    await page.goto(base + '?slow=' + slow);
    await page.waitForFunction(() => window.ready);
    if (!lead) lead = (Date.now() - t0) / 1000; // blank page before this is trimmed
    const items = await page.locator('#dock button').all();
    const at = async (i) => { const b = await items[i].boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    const press = async (i, caption, steps) => {
      const [x, y] = await at(i);
      await page.mouse.move(x, y, { steps });
      await page.evaluate((c) => window.setCaption(c), caption);
      await page.mouse.down(); await wait(40); await page.mouse.up();
    };
    const [sx, sy] = await at(0);
    await page.mouse.move(sx, sy + 30);
    await wait(700);
    await press(3, 'Today → Retirement', 14); await wait(400 + 500 * slow);
    await press(1, 'Retirement → Plan', 14); await wait(400 + 500 * slow);
    await press(4, 'Plan → Settings', 14); await wait(50 * slow);
    await press(0, '… retargeted to Today mid-flight', 4); await wait(600 + 500 * slow);
    const faults = await page.evaluate(() => window.pillFaults);
    if (faults.length) throw new Error(`springs pill hid or left the dock at ${slow}x: ${faults[0]}`);
  }
  await context.close();
  await browser.close();

  const [webm] = readdirSync(raw).filter((f) => f.endsWith('.webm'));
  const mp4 = path.join(out, 'dock-springs.mp4');
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', lead.toFixed(2), '-i', path.join(raw, webm),
    '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', mp4]);
  console.log('wrote', mp4);
}
if (!process.argv.includes('--serve')) server.close();
