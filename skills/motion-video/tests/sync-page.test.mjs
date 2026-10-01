// The sync page (scripts/sync-page) in Chromium: play/stop on the audio clock, the click schedule, nudge, a named
// marker dropped and dragged, Save, the animation fed the playhead's own t, and an old project copy without rebuild.
// Nobody can hear the clicks here, so the schedule is checked instead: every start(when) the page made, against
// the grid it shows.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { makeProject } from './harness.mjs';
import { startSync } from '../scripts/sync.mjs';

const SKILL = path.resolve(import.meta.dirname, '..');
const temps = [], closers = [];
after(async () => {
  for (const c of closers.reverse()) await c();
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

// A 4-bar project at 120 BPM whose loop starts at bar 2, so a nudge keeps the window inside the song.
function project() {
  const dir = makeProject({ bars: 4 });
  temps.push(path.dirname(dir));
  execFileSync('python3', [path.join(SKILL, 'scripts', 'analyze_song.py'), path.join(path.dirname(dir), 'beat.wav'),
    '--out', dir, '--bars', '4', '--start-bar', '2'], { stdio: 'pipe' });
  return dir;
}
const songOf = (dir) => JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8'));

async function open(dir) {
  const server = await startSync(dir, {});
  closers.push(() => server.close());
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  closers.push(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.goto(server.url);
  await page.waitForFunction(() => window.syncReady === true || window.syncError, null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => window.syncError ?? null), null);
  const state = (fn) => page.evaluate(fn);
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const frame = () => page.frames().find((f) => f !== page.mainFrame());
  return { page, errors, state, frames, frame };
}

const mod = (x, m) => ((x % m) + m) % m;

test('sync page: play on the audio clock, nudge, clicks, a marker, Save, and the animation at the playhead', async () => {
  const dir = project();
  const before = songOf(dir);
  const { page, errors, state, frames, frame } = await open(dir);

  // Space plays; the iframe's seek gets the page's playhead, which follows the audio clock
  await frame().evaluate(() => {
    const seek = window.seek;
    window.__got = [];
    window.seek = (t) => { window.__got.push(t); seek(t); };
  });
  await page.keyboard.press('Space');
  assert.equal(await state(() => window.syncState.playing), true);
  await page.waitForTimeout(600);
  const live = await page.evaluate(() => {
    const s = window.syncState, f = document.querySelector('iframe').contentWindow;
    return { got: f.__got.slice(), t: s.t, clock: s.clockT(), clicks: s.clicks.slice(), grid: s.clickTimes.map((c) => c.t),
      startedAt: s.startedAt, L: s.loopSec };
  });
  assert.ok(live.got.length > 10, `seek called ${live.got.length} times while playing`);
  assert.ok(live.got.at(-1) > 0.3, `t moved with the audio clock: ${live.got.at(-1)}`);
  assert.ok(Math.abs(live.clock - live.got.at(-1)) < 0.1, `seek t ${live.got.at(-1)} vs audio clock ${live.clock}`);
  // every click went out on the audio clock, exactly on a grid time
  assert.ok(live.clicks.length >= 1, 'clicks were scheduled');
  for (const c of live.clicks) {
    const at = mod(c.when - live.startedAt, live.L);
    assert.ok(live.grid.some((g) => Math.abs(mod(g, live.L) - at) < 1e-6), `click at loop ${at} is on the grid`);
  }
  await page.keyboard.press('Space');
  assert.equal(await state(() => window.syncState.playing), false);
  await frames();
  // stopped: the animation shows exactly the playhead's t
  const still = await page.evaluate(() => ({ t: window.syncState.t, got: document.querySelector('iframe').contentWindow.__got.at(-1) }));
  assert.equal(still.got, still.t);

  // nudge: 5 ms a press, previewed on the grid and the click schedule (the audio does not move until Save)
  // (a nudged grid is the user's: each beat sounds on its grid time t, no snapping to onsets, as Save will write it)
  const grid0 = before.beats.map((b) => b.t);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await state(() => window.syncState.pending.nudge_ms), -10);
  const grid1 = await state(() => window.syncState.clickTimes.map((c) => c.t));
  assert.equal(grid1.length, grid0.length);
  grid1.forEach((t, i) => assert.ok(Math.abs(t - (grid0[i] - 0.010)) < 1e-6, `beat ${i}: ${t} vs ${grid0[i]} - 10 ms`));
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  const nudged = await state(() => ({ clicks: window.syncState.clicks.slice(), startedAt: window.syncState.startedAt, L: window.syncState.loopSec }));
  await page.keyboard.press('Space');
  assert.ok(nudged.clicks.length >= 1);
  for (const c of nudged.clicks) {
    const at = mod(c.when - nudged.startedAt, nudged.L);
    assert.ok(grid1.some((g) => Math.abs(mod(g, nudged.L) - at) < 1e-6), `nudged click at loop ${at} is on the nudged grid`);
  }
  assert.ok(await state(() => window.syncState.rebuilds) >= 1, 'the animation previewed the nudge (rebuild)');

  // M drops a marker at the playhead; it is named inline
  const t = await state(() => window.syncState.t);
  await page.keyboard.press('m');
  await page.keyboard.type('drop');
  await page.keyboard.press('Enter');
  const m0 = await state(() => window.syncState.pending.markers[0]);
  assert.equal(m0.name, 'drop');
  assert.ok(Math.abs(m0.t - (t + before.loop.start_sec)) < 0.05, `marker at ${m0.t}, playhead at song ${t + before.loop.start_sec}`);

  // drag its flag 50 px to the right: later in the song
  const box = await page.locator('[data-marker="drop"] .flag').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const m1 = await state(() => window.syncState.pending.markers[0]);
  assert.ok(m1.t > m0.t + 0.01, `dragged from ${m0.t} to ${m1.t}`);
  assert.equal(await state(() => window.syncState.dirty), true);

  // Ctrl+S saves: song.json on disk has the nudge and the marker
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.syncState.saves === 1 || window.syncState.error, null, { timeout: 60000 });
  assert.equal(await state(() => window.syncState.error), null);
  const saved = songOf(dir);
  assert.equal(saved.sync.nudge_ms, -10);
  assert.equal(saved.sync.markers.length, 1);
  assert.equal(saved.sync.markers[0].name, 'drop');
  assert.ok(Math.abs(saved.sync.markers[0].t - m1.t) < 0.001);
  assert.ok(saved.markers.find((m) => m.name === 'drop'));
  assert.equal(await state(() => window.syncState.dirty), false);
  assert.equal(await state(() => window.syncState.pending.nudge_ms), -10);
  assert.deepEqual(await state(() => window.syncState.clickTimes.map((c) => c.t)),
    await state(() => window.syncState.song.beats.map((b) => b.cue_t ?? b.t)), 'after Save the grid is the saved one');

  // the animation at the playhead: seek got the playhead's t, and seeking that t again changes nothing
  await page.mouse.click(...await page.locator('#wave').boundingBox().then((b) => [b.x + b.width * 0.6, b.y + b.height * 0.7]));
  await frames();
  const check = await page.evaluate(() => {
    const f = document.querySelector('iframe').contentWindow, t = window.syncState.t;
    const shown = f.document.querySelector('#stage').outerHTML;
    f.seek(t);
    return { t, got: f.__got?.at(-1), last: window.syncState.lastSeek, same: f.document.querySelector('#stage').outerHTML === shown,
      cursor: f.inspect(t).cursor };
  });
  assert.equal(check.last, check.t);
  assert.ok(check.same, 'seek(t) at the playhead is what the frame already showed');
  assert.ok(Number.isFinite(check.cursor.x) && Number.isFinite(check.cursor.y));
  assert.deepEqual(errors, []);
});

test('sync page: an old project copy without rebuild loads, plays, and saves (the animation reloads)', async () => {
  const dir = project();
  const f = path.join(dir, 'index.html'), html = readFileSync(f, 'utf8');
  assert.ok(html.includes('window.rebuild ='), 'the template defines window.rebuild');
  writeFileSync(f, html.replace('window.rebuild =', 'window.notRebuild ='));
  const { page, errors, state, frame } = await open(dir);
  assert.equal(await frame().evaluate(() => typeof window.rebuild), 'undefined');
  // a copy older still, without components/core/timing.js, gets the kit's from /__sync/timing.js
  assert.equal(await page.evaluate(() => fetch('/__sync/timing.js').then((r) => r.ok && r.headers.get('content-type'))), 'text/javascript');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  assert.equal(await state(() => window.syncState.playing), true);
  await page.keyboard.press('Space');
  await page.keyboard.press('Shift+ArrowRight');
  assert.equal(await state(() => window.syncState.pending.nudge_ms), 20);
  await frame().evaluate(() => { window.__stale = true; });
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.syncState.saves === 1 || window.syncState.error, null, { timeout: 60000 });
  assert.equal(await state(() => window.syncState.error), null);
  assert.equal(songOf(dir).sync.nudge_ms, 20);
  await page.waitForFunction(() => window.syncState.iframeReloads === 1, null, { timeout: 30000 });
  assert.equal(await frame().evaluate(() => window.__stale ?? null), null, 'the iframe was reloaded');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  assert.equal(await state(() => window.syncState.playing), true);
  await page.keyboard.press('Space');
  assert.deepEqual(errors, []);
});
