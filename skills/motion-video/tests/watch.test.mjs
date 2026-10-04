// watch.mjs and its page in Chromium: a save reloads only the iframe (the wrapper's audio and playhead carry on),
// quick saves are one reload, tables that do not run keep the last good page and show the error, check_brief's
// result reaches the panel, and --brief serves the brief's tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { makeProject } from './harness.mjs';
import { startWatch } from '../scripts/watch.mjs';

const tables = (label) => ({ bars: 2,
  states: `[{ at: 0, use: 'button', label: '${label}' }, { at: END - 2, use: 'button', label: '${label}' }]`,
  cursor: '[{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]' });

const brief = (code) => `# Motion brief\n\n## Request\nA promo.\n\n## Decisions\n- square\n\n## Moments\n1. Import -> button\n\n## Beat table\n\n\`\`\`js\n${code}\n\`\`\`\n`;

const edit = (dir, f, fn) => { const p = path.join(dir, f); writeFileSync(p, fn(readFileSync(p, 'utf8'))); };

// Waits until fn() is truthy (polling, 20 ms), or fails after ms.
async function until(fn, ms = 2000, what = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// Starts the watcher and opens its page; fn gets { w, page, frameText, state }. Everything closes after.
async function watched(dir, opts, fn) {
  const w = await startWatch(dir, { debounceMs: 50, quiet: true, ...opts });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e));
    await page.goto(w.url);
    await page.waitForFunction(() => window.watchState?.frameReady === true, null, { timeout: 30000 });
    const frameText = () => page.evaluate(() => document.querySelector('#frame').contentDocument?.body?.textContent ?? '');
    const state = () => page.evaluate(() => ({ ...window.watchState }));
    await fn({ w, page, frameText, state });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await w.close();
  }
}

test('watch: the page shows the project; a save reloads only the iframe and the playhead carries on', async () => {
  const dir = makeProject(tables('Alpha'));
  await watched(dir, {}, async ({ w, page, frameText, state }) => {
    assert.equal(w.status().ok, true);
    assert.equal(w.status().version, 1);
    assert.equal(await page.evaluate(() => typeof document.querySelector('#frame').contentWindow.seek), 'function');
    assert.match(await frameText(), /Alpha/);
    const audioId = await page.evaluate(() => document.querySelector('audio').dataset.id);
    assert.ok(audioId);
    // play (a real click on the overlay) and let the playhead move; the audio's own time does not wrap with the loop
    const clock = () => page.evaluate(() => document.querySelector('audio').currentTime);
    await page.click('#overlay');
    await until(async () => (await clock()) > 0.3, 10000, 'the playhead to move');
    const before = await clock();
    edit(dir, 'index.html', (s) => s.replaceAll("'Alpha'", "'Bravo'"));
    await until(() => w.status().version === 2, 2000, 'version 2');
    await until(async () => /Bravo/.test(await frameText()) && (await state()).frameReady, 2000, 'the new label in the iframe');
    const after = await state();
    assert.equal(after.version, 2);
    assert.equal(await page.evaluate(() => document.querySelector('audio').dataset.id), audioId, 'the same audio element');
    assert.equal(await page.evaluate(() => document.querySelector('audio').paused), false, 'still playing');
    const now = await clock();
    assert.ok(now > before, `the playhead kept going (${before} -> ${now}), not back to 0`);
    // the new frame is seeked to the wrapper's playhead
    await until(async () => { const s = await state(); return s.lastSeek != null && s.lastSeek === s.t; }, 2000, 'a seek of the reloaded frame');
  });
});

test('watch: two writes 20 ms apart are one reload', async () => {
  const dir = makeProject(tables('Alpha'));
  const w = await startWatch(dir, { debounceMs: 50, quiet: true });
  try {
    edit(dir, 'index.html', (s) => s.replaceAll("'Alpha'", "'Bravo'"));
    await new Promise((r) => setTimeout(r, 20));
    edit(dir, 'index.html', (s) => s.replaceAll("'Bravo'", "'Charlie'"));
    await until(() => w.status().version === 2, 2000, 'version 2');
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(w.status().version, 2);
  } finally { await w.close(); }
});

test('watch: tables that do not run keep the last good page and show the error; fixing them reloads', async () => {
  const dir = makeProject(tables('Alpha'));
  await watched(dir, {}, async ({ w, page, frameText }) => {
    const good = readFileSync(path.join(dir, 'index.html'), 'utf8');
    edit(dir, 'index.html', (s) => s.replace("label: 'Alpha' }", "label: 'Alpha' ]"));
    await until(() => w.status().errors.length, 2000, 'the tables error');
    assert.equal(w.status().version, 1);
    assert.equal(w.status().ok, false);
    assert.match(w.status().errors[0], /^beat table code does not run/);
    const json = await page.evaluate(() => fetch('/__watch/status').then((r) => r.json()));
    assert.match(json.errors[0], /^beat table code does not run/);
    await page.waitForFunction(() => /beat table code does not run/.test(document.querySelector('#panel').textContent), null, { timeout: 2000 });
    assert.match(await frameText(), /Alpha/, 'the last good page stays');
    writeFileSync(path.join(dir, 'index.html'), good.replaceAll("'Alpha'", "'Delta'"));
    await until(() => w.status().version === 2, 2000, 'version 2 after the fix');
    assert.deepEqual(w.status().errors, []);
    await until(async () => /Delta/.test(await frameText()), 2000, 'the fixed page');
    await page.waitForFunction(() => !/beat table code/.test(document.querySelector('#panel').textContent), null, { timeout: 2000 });
  });
});

// Tables that run but break the engine's rules: the server's validator holds them back, so the page never loads them.
for (const [what, from, to, message] of [
  ['an unknown marker', "{ at: END - 2, use: 'button', label: 'Alpha' }", "{ at: 'dorp', use: 'button', label: 'Alpha' }, { at: END - 2, use: 'button', label: 'Alpha' }", /states\(\) row 2: unknown marker 'dorp'/],
  ['a component typo', "{ at: 0, use: 'button'", "{ at: 0, use: 'buton'", /unknown component "buton" at beat 0: did you mean "button"\?/],
]) {
  test(`watch: ${what} keeps the last good page, with the validator's error; fixing it reloads`, async () => {
    const dir = makeProject(tables('Alpha'));
    await watched(dir, {}, async ({ w, page, frameText }) => {
      const good = readFileSync(path.join(dir, 'index.html'), 'utf8');
      assert.ok(good.includes(from));
      writeFileSync(path.join(dir, 'index.html'), good.replace(from, to));
      await until(() => w.status().errors.length, 5000, "the validator's error");
      assert.equal(w.status().version, 1, 'no reload');
      assert.equal(w.status().ok, false);
      assert.match(w.status().errors.join('\n'), message);
      const json = await page.evaluate(() => fetch('/__watch/status').then((r) => r.json()));
      assert.match(json.errors.join('\n'), message);
      await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#panel').textContent), message.source, { timeout: 2000 });
      await new Promise((r) => setTimeout(r, 300));
      assert.match(await frameText(), /Alpha/, 'the last good page stays');
      writeFileSync(path.join(dir, 'index.html'), good.replaceAll("'Alpha'", "'Delta'"));
      await until(() => w.status().version === 2, 5000, 'version 2 after the fix');
      assert.deepEqual(w.status().errors, []);
      await until(async () => /Delta/.test(await frameText()), 5000, 'the fixed page');
    });
  });
}

test('watch: a page that fails only in the browser keeps the last good frame, and its error reaches the status', async () => {
  const dir = makeProject(tables('Alpha'));
  await watched(dir, {}, async ({ w, page, frameText, state }) => {
    const good = readFileSync(path.join(dir, 'index.html'), 'utf8');
    // content runs on every seek (the page seeks to 0 before ready resolves); validate() never sees it
    const bad = good.replaceAll("'Alpha'", "'Bravo'").replace('const content = {};', "const content = { boom: () => { throw new Error('content boom'); } };");
    assert.notEqual(bad, good.replaceAll("'Alpha'", "'Bravo'"));
    writeFileSync(path.join(dir, 'index.html'), bad);
    await until(() => w.status().version === 2, 5000, 'version 2 (the tables pass the validator)');
    await until(() => w.status().errors.some((e) => /content boom/.test(e)), 5000, 'the page error in the status');
    assert.equal(w.status().ok, false);
    const json = await page.evaluate(() => fetch('/__watch/status').then((r) => r.json()));
    assert.match(json.errors.join('\n'), /content boom/);
    await page.waitForFunction(() => /content boom/.test(document.querySelector('#panel').textContent), null, { timeout: 2000 });
    assert.match(await frameText(), /Alpha/, 'the last good frame stays');
    assert.doesNotMatch(await frameText(), /Bravo/);
    assert.equal((await state()).frameReady, true);
    writeFileSync(path.join(dir, 'index.html'), good.replaceAll("'Alpha'", "'Delta'"));
    await until(() => w.status().version === 3, 5000, 'version 3 after the fix');
    await until(async () => /Delta/.test(await frameText()), 5000, 'the fixed page');
    await until(() => w.status().ok, 5000, 'the page error to clear');
  });
});

test("watch: a brief whose tables run but fail check_brief still reloads, and the status has check_brief's error", async () => {
  const dir = makeProject(tables('Alpha'));
  await watched(dir, {}, async ({ w, page }) => {
    // a state held 1 beat (min_hold_beats is 2): the tables run, check_brief fails them
    writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(`const states = () => [
  { at: 0, use: 'button', label: 'Go' }, { at: 1, use: 'check' }, { at: END - 2, use: 'button', label: 'Go' }];
const cursor = () => [{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }];`));
    await until(() => w.status().version === 2, 2000, 'the reload');
    await page.waitForFunction(() => window.watchState.version === 2, null, { timeout: 2000 });
    await until(() => w.status().errors.length, 20000, "check_brief's result");
    assert.match(w.status().errors.join('\n'), /holds 1 beat; min_hold_beats is 2/);
    assert.equal(w.status().ok, false);
    await page.waitForFunction(() => /min_hold_beats/.test(document.querySelector('#panel').textContent), null, { timeout: 5000 });
  });
});

test("watch --brief serves the brief's tables", async () => {
  const dir = makeProject(tables('Alpha'));
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(`const states = () => [
  { at: 0, use: 'button', label: 'Briefed' }, { at: END - 2, use: 'button', label: 'Briefed' }];
const cursor = () => [{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }];`));
  await watched(dir, { brief: true }, async ({ w, frameText }) => {
    assert.match(await frameText(), /Briefed/);
    assert.doesNotMatch(await frameText(), /Alpha/);
    edit(dir, 'MOTION-BRIEF.md', (s) => s.replaceAll("'Briefed'", "'Rebriefed'"));
    await until(() => w.status().version === 2, 2000, 'version 2');
    await until(async () => /Rebriefed/.test(await frameText()), 2000, "the brief's new label");
  });
});

test('watch --brief: a brief broken at startup serves nothing (the frame waits, the status says so) until it is fixed', async () => {
  const dir = makeProject(tables('Alpha'));
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief('const states = () => [;'));
  const w = await startWatch(dir, { brief: true, debounceMs: 50, quiet: true });
  const browser = await chromium.launch();
  try {
    assert.equal((await fetch(w.url.replace(/__watch$/, 'index.html'))).status, 503);
    assert.equal((await fetch(w.url.replace(/__watch$/, ''))).status, 503);
    assert.equal(w.status().ok, false);
    assert.match(w.status().errors.join('\n'), /beat table code does not run/);
    assert.match(w.status().errors.join('\n'), /nothing to preview until the brief's tables pass/);
    const page = await browser.newPage();
    await page.goto(w.url);
    await page.waitForFunction(() => window.watchState.waiting === true, null, { timeout: 10000 });
    await page.waitForFunction(() => /nothing to preview/.test(document.querySelector('#panel').textContent), null, { timeout: 2000 });
    assert.doesNotMatch(await page.evaluate(() => document.querySelector('#frame').contentDocument?.body?.textContent ?? ''), /Alpha/);
    writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(`const states = () => [
  { at: 0, use: 'button', label: 'Briefed' }, { at: END - 2, use: 'button', label: 'Briefed' }];
const cursor = () => [{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }];`));
    await until(() => w.status().version === 2, 5000, 'version 2');
    await page.waitForFunction(() => /Briefed/.test(document.querySelector('#frame').contentDocument?.body?.textContent ?? ''), null, { timeout: 10000 });
    assert.doesNotMatch(w.status().errors.join('\n'), /nothing to preview/);
  } finally {
    await browser.close();
    await w.close();
  }
});

test("watch: deleting the brief clears its errors from the page's panel", async () => {
  const dir = makeProject(tables('Alpha'));
  // no ## Request, ## Decisions or ## Moments: check_brief has errors
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), "## Beat table\n\n```js\nconst states = () => [{ at: 0, use: 'button', label: 'Go' }, { at: END - 2, use: 'button', label: 'Go' }];\nconst cursor = () => [{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }];\n```\n");
  await watched(dir, {}, async ({ w, page }) => {
    await page.waitForFunction(() => /missing section/.test(document.querySelector('#panel').textContent), null, { timeout: 20000 });
    rmSync(path.join(dir, 'MOTION-BRIEF.md'));
    await until(() => w.status().version === 2, 5000, 'the reload');
    await page.waitForFunction(() => !/missing section/.test(document.querySelector('#panel').textContent), null, { timeout: 5000 });
    assert.equal(w.status().ok, true);
  });
});

test('watch: a watcher error prints error: and closes the watch', async () => {
  const dir = makeProject(tables('Alpha'));
  const fakes = [];
  const fsWatch = () => { const e = new EventEmitter(); e.close = () => { e.closed = true; }; fakes.push(e); return e; };
  const lines = [], was = console.error;
  console.error = (s) => lines.push(String(s));
  try {
    const w = await startWatch(dir, { debounceMs: 50, fsWatch });
    fakes[0].emit('error', Object.assign(new Error('EMFILE: too many open files, watch'), { code: 'EMFILE' }));
    await w.closed;
    assert.ok(fakes.every((f) => f.closed), 'every watcher closed');
    assert.ok(lines.some((l) => /^error: watching .+ failed: EMFILE: too many open files/.test(l)), lines.join('\n'));
    await assert.rejects(fetch(w.url.replace(/__watch$/, '__watch/status')));
    await w.close();
  } finally { console.error = was; }
});

test('watch.mjs CLI: bad usage is error + exit 2; it prints the URL and Ctrl+C stops it', async () => {
  const SCRIPT = path.resolve(import.meta.dirname, '../scripts/watch.mjs');
  for (const args of [[], ['/no/such/dir'], ['.', '--port', 'x'], ['.', '--nope']]) {
    const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /^error: /);
  }
  const dir = makeProject(tables('Alpha'));
  const child = spawn('node', [SCRIPT, dir, '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  await until(() => /watching: http:\/\/127\.0\.0\.1:\d+\/__watch/.test(out), 10000, 'the URL');
  const url = /watching: (\S+)/.exec(out)[1];
  assert.equal((await fetch(url.replace(/\/__watch$/, '/__watch/status')).then((r) => r.json())).version, 1);
  child.kill('SIGINT');
  const [code] = await once(child, 'exit');
  assert.equal(code, 130);
});
