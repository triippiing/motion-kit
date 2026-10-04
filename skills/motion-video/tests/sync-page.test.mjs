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

// A 4-bar project at 120 BPM whose loop starts at bar 2, so a nudge keeps the window inside the song. `opts` go to
// makeProject (states, cursor).
function project(opts = {}) {
  const dir = makeProject({ bars: 4, ...opts });
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
  // wait (not a fixed sleep, which a loaded machine can outrun) until the clock has moved and clicks went out
  await page.waitForFunction(() => {
    const s = window.syncState, f = document.querySelector('iframe').contentWindow;
    return f.__got.length > 10 && f.__got.at(-1) > 0.3 && s.clicks.length + s.skipped >= 1;
  }, null, { timeout: 30000 });
  const live = await page.evaluate(() => {
    const s = window.syncState, f = document.querySelector('iframe').contentWindow;
    return { got: f.__got.slice(), t: s.t, clock: s.clockT(), clicks: s.clicks.slice(), skipped: s.skipped, grid: s.clickTimes.map((c) => c.t),
      startedAt: s.startedAt, L: s.loopSec, span: s.scheduled() };
  });
  assert.ok(live.got.length > 10, `seek called ${live.got.length} times while playing`);
  assert.ok(live.got.at(-1) > 0.3, `t moved with the audio clock: ${live.got.at(-1)}`);
  assert.ok(Math.abs(live.clock - live.got.at(-1)) < 0.1, `seek t ${live.got.at(-1)} vs audio clock ${live.clock}`);
  // every click went out on the audio clock, exactly on a grid time
  assert.ok(live.clicks.length >= 1, `clicks were scheduled (${live.skipped} skipped as too late)`);
  for (const c of live.clicks) {
    const at = mod(c.when - live.startedAt, live.L);
    assert.ok(live.grid.some((g) => Math.abs(mod(g, live.L) - at) < 1e-6), `click at loop ${at} is on the grid`);
  }
  // and no beat was lost: one click per grid time in the span the scheduler covered, or one skipped because its tick
  // came too late (a loaded machine; the page stays silent rather than click off the grid)
  const [from, until] = live.span;
  let expected = 0;
  for (let k = Math.floor((from - live.startedAt) / live.L) - 1; live.startedAt + k * live.L < until; k++) {
    for (const g of live.grid) { const w = live.startedAt + k * live.L + mod(g, live.L); if (w >= from && w < until) expected++; }
  }
  assert.equal(live.clicks.length + live.skipped, expected, 'every beat in the scheduled span got a click (or was skipped as too late)');
  await page.keyboard.press('Space');
  assert.equal(await state(() => window.syncState.playing), false);
  await frames();
  // stopped: the animation shows exactly the playhead's t
  const still = await page.evaluate(() => ({ t: window.syncState.t, got: document.querySelector('iframe').contentWindow.__got.at(-1) }));
  assert.equal(still.got, still.t);

  // nudge: 5 ms a press, previewed on the grid and the click schedule (the audio does not move until Save)
  // (a nudged grid is the user's: each beat sounds on its grid time t, no snapping to onsets, as Save will write it)
  const grid0 = before.beats.map((b) => b.t);
  assert.match(await page.locator('#status').textContent(), /grid follows detected hits/);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await state(() => window.syncState.pending.nudge_ms), -10);
  assert.match(await page.locator('#status').textContent(), /even grid: detected hits off/);
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
  // Ctrl+S while the name is still empty saves nothing and keeps the prompt open, with a warning
  await page.keyboard.press('Control+s');
  assert.equal(await state(() => window.syncState.saves), 0);
  assert.equal(await state(() => window.syncState.saving), false);
  assert.ok(await state(() => window.syncState.warning));
  assert.equal(await page.locator('.namebox').count(), 1);
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

  // a note: clicking the flag selects the marker and shows a visible note field on its line in the markers list
  await page.locator('#right').click();
  const checked = await state(() => window.syncState.pending.checked_by_ear);
  assert.match(checked, /^\d{4}-\d{2}-\d{2}$/);
  await page.locator('[data-marker="drop"] .flag').click();
  const field = page.locator('#marker-list .notebox');
  assert.equal(await field.getAttribute('placeholder'), 'add a note');
  await field.click();
  await page.keyboard.type('the roll');
  await page.keyboard.press('Enter');
  assert.equal(await state(() => window.syncState.pending.markers[0].note), 'the roll');
  assert.equal(await state(() => window.syncState.pending.checked_by_ear), checked, 'a note does not clear Sounds right');
  await frames(); // flags are placed (and titled) on the next frame
  assert.match(await page.locator('[data-marker="drop"] .flag').getAttribute('title'), /the roll/);
  // N focuses the same field (pre-filled); typing there never reaches the page keys (Space, T...)
  await page.keyboard.press('n');
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'notebox');
  await page.keyboard.press('End');
  await page.keyboard.type(' into the chorus');
  assert.equal(await state(() => window.syncState.playing), false, 'Space in the note field did not play');
  assert.equal(await state(() => window.syncState.taps.length), 0, 'T in the note field did not tap');
  const note = 'the roll into the chorus';
  // Ctrl+S from inside the note field keeps the note and saves: song.json on disk has the nudge, marker and note
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.syncState.saves === 1 || window.syncState.error, null, { timeout: 60000 });
  assert.equal(await state(() => window.syncState.error), null);
  const saved = songOf(dir);
  assert.equal(saved.sync.nudge_ms, -10);
  assert.equal(saved.sync.markers.length, 1);
  assert.equal(saved.sync.markers[0].name, 'drop');
  assert.ok(Math.abs(saved.sync.markers[0].t - m1.t) < 0.001);
  assert.ok(saved.markers.find((m) => m.name === 'drop'));
  assert.equal(saved.sync.markers[0].note, note);
  assert.equal(saved.markers.find((m) => m.name === 'drop').note, note);
  assert.equal(saved.sync.checked_by_ear, checked);
  // a line in the marker list moves the playhead to its marker
  await page.locator('#marker-list .mrow[data-marker="drop"] .mname').click();
  const atMarker = await state(() => window.syncState.t + window.syncState.song.loop.start_sec);
  assert.ok(Math.abs(atMarker - saved.sync.markers[0].t) < 1e-6, `playhead at song ${atMarker}, marker at ${saved.sync.markers[0].t}`);
  assert.equal(await state(() => window.syncState.dirty), false);
  assert.ok(await state(() => window.syncState.t < window.syncState.loopSec), 'the playhead is inside the saved loop');
  assert.equal(await state(() => window.syncState.pending.nudge_ms), -10);
  assert.deepEqual(await state(() => window.syncState.clickTimes.map((c) => c.t)),
    await state(() => window.syncState.song.beats.map((b) => b.cue_t ?? b.t)), 'after Save the grid is the saved one');

  // the animation at the playhead: seek got the playhead's t, and seeking that t again changes nothing
  await page.mouse.click(...await page.locator('#wave').boundingBox().then((b) => [b.x + b.width * 0.6, b.y + b.height * 0.7]));
  await frames();
  const check = await page.evaluate(() => {
    const f = document.querySelector('iframe').contentWindow, t = window.syncState.t, d = f.document;
    const shown = d.querySelector('#stage').outerHTML;
    // where the frame drew the cursor tip: the cursor's translate (x - 7, y - 4) under the camera's scale z about the centre
    const [X, Y] = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/.exec(d.querySelector('#cursor').style.transform).slice(1).map(Number);
    const z = Number(/scale\(([-\d.e]+)\)/.exec(d.querySelector('#camera').style.transform)[1]);
    const CX = f.STAGE.width / 2, CY = f.STAGE.height / 2;
    const drawn = { x: CX + (X + 7 - CX) * z, y: CY + (Y + 4 - CY) * z };
    f.seek(t);
    return { t, last: window.syncState.lastSeek, same: d.querySelector('#stage').outerHTML === shown, drawn, cursor: f.inspect(t).cursor };
  });
  assert.equal(check.last, check.t);
  assert.ok(check.same, 'seek(t) at the playhead is what the frame already showed');
  assert.ok(Math.abs(check.drawn.x - check.cursor.x) < 0.01 && Math.abs(check.drawn.y - check.cursor.y) < 0.01,
    `inspect(t) ${JSON.stringify(check.cursor)} is where seek(t) drew the cursor ${JSON.stringify(check.drawn)}`);
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
  await page.keyboard.press('ArrowUp');
  assert.equal(await state(() => window.syncState.pending.nudge_ms), 5);
  await page.keyboard.press('Shift+ArrowUp');
  assert.equal(await state(() => window.syncState.pending.nudge_ms), 25);
  await frame().evaluate(() => { window.__stale = true; });
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.syncState.saves === 1 || window.syncState.error, null, { timeout: 60000 });
  assert.equal(await state(() => window.syncState.error), null);
  assert.equal(songOf(dir).sync.nudge_ms, 25);
  await page.waitForFunction(() => window.syncState.iframeReloads === 1, null, { timeout: 30000 });
  assert.equal(await frame().evaluate(() => window.__stale ?? null), null, 'the iframe was reloaded');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  assert.equal(await state(() => window.syncState.playing), true);
  await page.keyboard.press('Space');
  assert.deepEqual(errors, []);
});

test('sync page: arrow keys scrub the playhead (10 ms, a quarter beat, to the next beat line), Home, wrap, blips', async () => {
  const dir = project();
  const { page, errors, state, frames } = await open(dir);
  const t = () => state(() => window.syncState.t);
  const blips = () => state(() => window.syncState.blips.length);
  const { L, bs, lines } = await state(() => ({ L: window.syncState.loopSec, bs: window.syncState.grid.beat_sec,
    lines: window.syncState.clickTimes.map((c) => c.t) }));
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

  await page.keyboard.press('Home');
  near(await t(), 0, 'Home');
  assert.equal(await blips(), 1, 'a stopped scrub plays one blip');
  await page.keyboard.press('ArrowRight');
  near(await t(), 0.010, 'ArrowRight');
  assert.equal(await blips(), 2);
  const b = await state(() => window.syncState.blips.at(-1));
  near(b.t, 0.010, 'the blip plays from the new playhead');
  await page.keyboard.press('Shift+ArrowRight');
  near(await t(), 0.010 + bs / 4, 'Shift+ArrowRight');
  const here = await t();
  await page.keyboard.press('Alt+ArrowRight');
  const next = lines.map((x) => mod(x, L)).filter((x) => x > here + 1e-6).sort((x, y) => x - y)[0];
  near(await t(), next, 'Alt+ArrowRight lands on the next beat line');
  await page.keyboard.press('Alt+ArrowLeft');
  const prev = lines.map((x) => mod(x, L)).filter((x) => x < next - 1e-6).sort((x, y) => x - y).at(-1);
  near(await t(), prev, 'Alt+ArrowLeft lands on the previous beat line');
  // wrap at the loop edges
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowLeft');
  near(await t(), L - 0.010, 'ArrowLeft from 0 wraps to the loop end');
  await page.keyboard.press('ArrowRight');
  near(await t(), 0, 'and ArrowRight wraps back');
  // nudging is on up and down, never the playhead
  await page.keyboard.press('ArrowDown');
  assert.equal(await state(() => window.syncState.pending.nudge_ms), -5);
  near(await t(), 0, 'ArrowDown does not move the playhead');
  // the animation follows the scrubbed playhead
  await page.keyboard.press('Shift+ArrowRight');
  await frames();
  near(await state(() => window.syncState.lastSeek), bs / 4, 'seek(t) follows the scrub');
  // playing: a scrub seeks, and the clicks after it are on the grid, once each
  // a click on the loop strip moves the playhead there (a blip while stopped); a drag on its window only pans
  const strip = await page.locator('#overview').boundingBox();
  const nb = await blips();
  await page.mouse.click(strip.x + strip.width * 0.25, strip.y + strip.height / 2);
  const onePx = L / strip.width;
  assert.ok(Math.abs(await t() - 0.25 * L) <= onePx, `strip click at 25%: ${await t()} vs ${0.25 * L}`);
  assert.equal(await blips(), nb + 1);
  const view = await state(() => window.syncState.viewStart), before = await t();
  const V = await state(() => window.syncState.viewBars * window.syncState.grid.beats_per_bar * window.syncState.grid.beat_sec);
  const vx = strip.x + strip.width * ((((view + V / 2) % L) + L) % L / L); // the middle of the view's window
  await page.mouse.move(vx, strip.y + strip.height / 2);
  await page.mouse.down();
  await page.mouse.move(vx + 30, strip.y + strip.height / 2, { steps: 5 });
  await page.mouse.up();
  assert.equal(await t(), before, 'dragging the window leaves the playhead');
  const panned = await state(() => window.syncState.viewStart);
  assert.ok(Math.abs(panned - view) > 0.1, `and pans the view: ${view} -> ${panned} (L ${L}, x ${vx - strip.x} of ${strip.width})`);
  const n = await blips();
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForTimeout(500);
  const run = await state(() => ({ clicks: window.syncState.clicks.slice(), skipped: window.syncState.skipped, startedAt: window.syncState.startedAt,
    grid: window.syncState.clickTimes.map((c) => c.t), span: window.syncState.scheduled() }));
  await page.keyboard.press('Space');
  assert.equal(await blips(), n, 'no blip while playing');
  const whens = run.clicks.map((c) => c.when);
  assert.equal(new Set(whens.map((w) => w.toFixed(6))).size, whens.length, 'no doubled clicks');
  for (const c of run.clicks) {
    const at = mod(c.when - run.startedAt, L);
    assert.ok(run.grid.some((g) => Math.abs(mod(g, L) - at) < 1e-6), `click at loop ${at} is on the grid`);
  }
  const [from, until] = run.span;
  let expected = 0;
  for (let k = Math.floor((from - run.startedAt) / L) - 1; run.startedAt + k * L < until; k++) {
    for (const g of run.grid) { const w = run.startedAt + k * L + mod(g, L); if (w >= from && w < until) expected++; }
  }
  assert.equal(run.clicks.length + run.skipped, expected, 'every beat after the seek got a click (or was skipped as too late)');
  assert.deepEqual(errors, []);
});

test('sync page: a hostile checked_by_ear in song.json shows as text and never runs', async () => {
  const dir = project();
  const evil = '<img src=x onerror="window.__xss=1">';
  const song = songOf(dir);
  song.sync = { ...(song.sync ?? {}), checked_by_ear: evil };
  writeFileSync(path.join(dir, 'song.json'), JSON.stringify(song, null, 2));
  const { page, errors, frames } = await open(dir);
  await frames();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await page.locator('#status img').count(), 0);
  assert.ok((await page.locator('#status').textContent()).includes(`checked by ear ${evil}`));
  assert.deepEqual(errors, []);
});

test('sync page: a moment to place holds the animation until it is placed and saved', async () => {
  // the states table has a row at 'drop', which song.json does not have yet (as after a song swap): the project's own
  // page would throw on it, so the animation waits
  const dir = project({ states: "[{ at: 0, use: 'button' }, { at: 'drop', use: 'button' }, { at: 2, use: 'button' }, { at: END - 2, use: 'button' }]",
    cursor: '[{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]' });
  const { page, errors, state } = await open(dir);
  assert.ok(await page.locator('#to-place').isVisible());
  assert.deepEqual(await page.locator('#to-place button').allTextContents(), ['drop']);
  assert.match(await page.locator('#anim').innerText(), /place these moments to see the animation: drop/);
  assert.equal(await page.locator('#frame').getAttribute('src'), null, 'the animation is not loaded');
  assert.equal(await state(() => window.syncState.animReady), false);

  // select drop, put the playhead on beat 1 (between the rows at 0 and 2), M: the marker is named drop, no prompt
  await page.locator('#to-place button', { hasText: 'drop' }).click();
  assert.equal(await state(() => window.syncState.placing), 'drop');
  await page.keyboard.press('Home');
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('m');
  assert.equal(await page.locator('.namebox').count(), 0, 'no name prompt');
  const ms = await state(() => window.syncState.pending.markers);
  assert.deepEqual(ms.map((m) => m.name), ['drop']);
  assert.equal(await state(() => window.syncState.placing), null);
  assert.ok(await page.locator('#to-place').isHidden(), 'nothing left to place in the pending markers');
  assert.equal(await page.locator('#frame').getAttribute('src'), null, 'still waiting for Save');
  // every name is placed in the pending markers: the hold says to save, it no longer lists names
  assert.match(await page.locator('#frame-wait').innerText(), /^save to see the animation$/);

  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.syncState.saves === 1 || window.syncState.error, null, { timeout: 60000 });
  assert.equal(await state(() => window.syncState.error), null);
  await page.waitForFunction(() => window.syncState.animReady === true, null, { timeout: 30000 });
  assert.ok(await page.locator('#to-place').isHidden());
  assert.equal(await page.locator('#frame').getAttribute('src'), '/index.html');
  assert.ok(await page.locator('#frame').isVisible());
  assert.doesNotMatch(await page.locator('#anim').innerText(), /place these moments/);
  assert.deepEqual(await state(() => window.syncState.needed), []);

  // removing it again and saving holds the animation once more
  await page.locator('#marker-list .mrow[data-marker="drop"] .mname').click();
  await page.keyboard.press('Delete');
  assert.equal(await state(() => window.syncState.pending.markers.length), 0);
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.syncState.saves === 2 || window.syncState.error, null, { timeout: 60000 });
  assert.equal(await state(() => window.syncState.error), null);
  assert.equal(await state(() => window.syncState.animReady), false);
  assert.equal(await page.locator('#frame').getAttribute('src'), null);
  assert.match(await page.locator('#anim').innerText(), /place these moments to see the animation: drop/);
  assert.deepEqual(await page.locator('#to-place button').allTextContents(), ['drop']);
  assert.deepEqual(errors, []);
});

test('sync page: a project with nothing to place loads the animation at once, no "to place" list', async () => {
  const dir = project();
  const { page, errors, state } = await open(dir);
  assert.ok(await page.locator('#to-place').isHidden());
  assert.equal(await state(() => window.syncState.animReady), true);
  assert.equal(await page.locator('#frame').getAttribute('src'), '/index.html');
  assert.doesNotMatch(await page.locator('#anim').innerText(), /place these moments/);
  // M still asks for a name
  await page.keyboard.press('m');
  assert.equal(await page.locator('.namebox').count(), 1);
  assert.deepEqual(errors, []);
});

test('sync page: a table marker name the page cannot use is listed with a rename note, never selectable; M still works', async () => {
  const dir = project({ states: "[{ at: 0, use: 'button' }, { at: 'Drop', use: 'button' }, { at: 2, use: 'button' }, { at: END - 2, use: 'button' }]",
    cursor: '[{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]' });
  const { page, errors, state } = await open(dir);
  assert.ok(await page.locator('#to-place').isVisible());
  assert.match(await page.locator('#to-place').innerText(), /Drop.*rename it in the table: marker names are lowercase letters, digits and -/);
  assert.equal(await page.locator('#to-place button:not([disabled])').count(), 0, 'nothing to select');
  await page.locator('#to-place [data-name="Drop"]').click({ force: true });
  assert.equal(await state(() => window.syncState.placing), null);
  assert.match(await page.locator('#anim').innerText(), /place these moments to see the animation: Drop/);
  // M is a normal draft with the name prompt; Escape cancels it; M works again
  await page.keyboard.press('m');
  assert.equal(await page.locator('.namebox').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.namebox').count(), 0);
  await page.keyboard.press('m');
  assert.equal(await page.locator('.namebox').count(), 1);
  assert.deepEqual(errors, []);
});

// ---------------- suggestions (C2b) ----------------

// A project like project()'s whose beat.wav is a click track made with click_track.py's options (e.g. ['--swing',
// '0.62']), analysed the same way, so song.json carries that suggestion.
function suggested(bpm, seconds, flags) {
  const dir = makeProject({ bars: 4 });
  temps.push(path.dirname(dir));
  const wav = path.join(path.dirname(dir), 'beat.wav');
  execFileSync('python3', [path.join(SKILL, 'scripts', 'click_track.py'), wav, String(bpm), '--seconds', String(seconds), ...flags], { stdio: 'pipe' });
  execFileSync('python3', [path.join(SKILL, 'scripts', 'analyze_song.py'), wav, '--out', dir, '--bars', '4', '--start-bar', '2'], { stdio: 'pipe' });
  return dir;
}
const saveAndWait = async (page, n) => {
  await page.keyboard.press('Control+s');
  await page.waitForFunction((n) => window.syncState.saves === n || window.syncState.error, n, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.syncState.error), null);
};

test('sync page suggestions: swing is listed; Try previews it and toggles back; Keep + Save writes it and the item goes', async () => {
  const dir = suggested(110, 30, ['--swing', '0.62']);
  const sug = songOf(dir).suggestions;
  assert.deepEqual(Object.keys(sug), ['swing']);
  // (the brief says "swing 0.62": the detector reads this track as 0.61, within its 0.03; the label is its own value)
  const v = sug.swing.value;
  assert.ok(Math.abs(v - 0.62) <= 0.03, `swing ${v}`);
  const { page, errors, state } = await open(dir);
  const list = page.locator('#suggestions');
  assert.ok(await list.isVisible());
  assert.equal(await list.locator('.srow').count(), 1);
  const row = list.locator('.srow[data-key="swing"]');
  assert.match(await row.innerText(), new RegExp(`swing ${v.toFixed(2)}`));
  assert.match(await row.innerText(), new RegExp(sug.swing.reason.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(await row.innerText(), /confidence/);

  // Try: the clicks follow the swung grid (each beat's off-beat now clicks, at the suggested swing); nothing pending
  // changes. (Beat clicks alone cannot change with swing, which only moves the off-beats: a swung grid clicks those too.)
  const clicks = () => state(() => window.syncState.clickTimes.map((c) => ({ beat: c.beat, t: c.t })));
  const straight = await state(() => JSON.stringify(window.syncState.pending));
  const plain = await clicks();
  assert.ok(plain.every((c) => Number.isInteger(c.beat)), 'a straight grid clicks the beats only');
  const tryBtn = row.locator('button', { hasText: 'Try' });
  await tryBtn.click();
  assert.equal(await state(() => window.syncState.trying), 'swing');
  const swung = await clicks();
  assert.notDeepEqual(swung, plain, 'Try changes the click schedule');
  // (each off-beat sits at swing v of the beat's grid span after the beat's own cue, as timing.js places it)
  const g = await state(() => window.syncState.grid.beats.map((b) => ({ t: b.t, cue: b.cue_t ?? b.t })));
  const offs = swung.filter((c) => !Number.isInteger(c.beat));
  assert.equal(offs.length, plain.length);
  for (const o of offs.slice(0, -1)) {
    const i = o.beat - 0.5, f = (o.t - g[i].cue) / (g[i + 1].t - g[i].t);
    assert.ok(Math.abs(f - v) < 1e-6, `off-beat ${o.beat} at ${f} of the beat, swing ${v}`);
  }
  assert.equal(await tryBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(await state(() => JSON.stringify(window.syncState.pending)), straight, 'Try saves nothing');
  assert.equal(await state(() => window.syncState.dirty), false);
  await tryBtn.click();
  assert.equal(await state(() => window.syncState.trying), null);
  assert.deepEqual(await clicks(), plain, 'Try toggles back');
  // buttons never keep the focus: Space still plays
  await page.keyboard.press('Space');
  assert.equal(await state(() => window.syncState.playing), true);
  await page.keyboard.press('Space');

  // Keep: pending swing; Save writes it; the analyser no longer suggests it, so the list goes
  await row.locator('button', { hasText: 'Keep' }).click();
  assert.equal(await state(() => window.syncState.pending.swing), v);
  assert.equal(await state(() => window.syncState.dirty), true);
  await saveAndWait(page, 1);
  const saved = songOf(dir);
  assert.equal(saved.sync.swing, v);
  assert.ok(!('swing' in saved.suggestions));
  assert.ok(await list.isHidden(), 'no suggestions left: no list');
  assert.deepEqual(errors, []);
});

test('sync page suggestions: Dismiss + Save writes dismissed; the item stays hidden after a reload', async () => {
  const dir = suggested(150, 30, ['--meter', '3/4']);
  const sug = songOf(dir).suggestions;
  assert.equal(sug.meter?.value, '3/4');
  const { page, errors, state } = await open(dir);
  const row = page.locator('#suggestions .srow[data-key="meter"]');
  assert.match(await row.innerText(), /meter 3\/4/);
  // Try meter: the clicks' bars are 3 beats long
  await row.locator('button', { hasText: 'Try' }).click();
  const downs = await state(() => window.syncState.clickTimes.filter((c) => c.down).map((c) => c.beat));
  assert.deepEqual(downs.slice(0, 3), [0, 3, 6]);
  await row.locator('button', { hasText: 'Try' }).click();
  assert.deepEqual((await state(() => window.syncState.clickTimes.filter((c) => c.down).map((c) => c.beat))).slice(0, 3), [0, 4, 8]);

  await row.locator('button', { hasText: 'Dismiss' }).click();
  assert.deepEqual(await state(() => window.syncState.pending.dismissed), [{ key: 'meter', value: '3/4' }]);
  assert.equal(await state(() => window.syncState.pending.meter), '4/4', 'Dismiss changes no grid field');
  await saveAndWait(page, 1);
  const saved = songOf(dir);
  assert.deepEqual(saved.sync.dismissed, [{ key: 'meter', value: '3/4' }]);
  assert.ok(!('meter' in saved.suggestions));
  await page.reload();
  await page.waitForFunction(() => window.syncReady === true || window.syncError, null, { timeout: 30000 });
  assert.ok(await page.locator('#suggestions').isHidden());
  assert.equal(await page.locator('#suggestions .srow').count(), 0);
  assert.deepEqual(errors, []);
});

test('sync page suggestions: a tempo map is tried at its own beats; Keep + Save writes it and clears Sounds right', async () => {
  const dir = suggested(90, 60, ['--tempo-map', '0:90,20:120']);
  const song = songOf(dir), tm = song.suggestions.tempo_map;
  assert.deepEqual(Object.keys(song.suggestions), ['tempo_map'], 'a tempo map is offered alone');
  const { page, errors, state } = await open(dir);
  const row = page.locator('#suggestions .srow[data-key="tempo_map"]');
  assert.match(await row.innerText(), /tempo map: 90 → 120 at 0:19/);
  await page.locator('#right').click();
  assert.ok(await state(() => window.syncState.pending.checked_by_ear));
  const before = await state(() => window.syncState.clickTimes.map((c) => c.t));
  await row.locator('button', { hasText: 'Try' }).click();
  const L = song.loop.duration_sec, start = song.loop.start_sec;
  const want = tm.beats.map((b) => b - start).filter((t) => t >= -1e-6 && t < L - 1e-6);
  const got = await state(() => window.syncState.clickTimes.map((c) => c.t));
  assert.notDeepEqual(got, before);
  assert.equal(got.length, want.length);
  got.forEach((t, i) => assert.ok(Math.abs(t - want[i]) < 1e-5, `click ${i}: ${t} vs the map's beat ${want[i]}`));
  await row.locator('button', { hasText: 'Try' }).click();
  assert.deepEqual(await state(() => window.syncState.clickTimes.map((c) => c.t)), before);

  await row.locator('button', { hasText: 'Keep' }).click();
  assert.deepEqual(await state(() => window.syncState.pending.tempo_map), tm.segments);
  assert.equal(await state(() => window.syncState.pending.checked_by_ear ?? null), null, 'keeping a tempo map clears Sounds right');
  await saveAndWait(page, 1);
  const saved = songOf(dir);
  assert.deepEqual(saved.sync.tempo_map, tm.segments);
  assert.ok(!('checked_by_ear' in saved.sync));
  assert.ok(!('tempo_map' in saved.suggestions));
  assert.deepEqual(errors, []);
});

test('sync page suggestions: a pickup has no Try; Keep stores pickup_beats and leaves the bars until Save', async () => {
  const dir = suggested(100, 30, ['--pickup', '2']);
  const sug = songOf(dir).suggestions;
  assert.equal(sug.pickup?.beats, 2);
  const { page, errors, state } = await open(dir);
  const row = page.locator('#suggestions .srow[data-key="pickup"]');
  assert.match(await row.innerText(), /pickup: 2 beats/);
  // the loop's clip cannot play the song before its own start: nothing to try
  assert.equal(await row.locator('button', { hasText: 'Try' }).count(), 0);
  assert.match(await row.innerText(), /applies to a loop that starts with the song \(--from-start\); Save re-fits it/);
  assert.match(await row.innerText(), /analyze_song\.py SONG --out DIR --from-start/);
  assert.match(await row.innerText(), /swap_song\.mjs DIR SONG --from-start/);
  const bars = () => state(() => ({ downs: window.syncState.clickTimes.filter((c) => c.down).map((c) => c.beat),
    lead: window.syncState.grid.lead ?? 0 }));
  const before = await bars();
  assert.deepEqual(before.downs.slice(0, 2), [0, 4]);
  await row.locator('button', { hasText: 'Keep' }).click();
  assert.equal(await state(() => window.syncState.pending.pickup_beats), 2);
  assert.deepEqual(await bars(), before, 'Keep leaves the page\'s bars as they are');
  await saveAndWait(page, 1);
  assert.equal(songOf(dir).sync.pickup_beats, 2);
  assert.deepEqual(errors, []);
});

test('sync page suggestions: Keep on a swing with a tempo sets both; Save clears Sounds right (bpm is the grid)', async () => {
  // a 96 BPM shuffle read at 128 (4/3 of it): the swing suggestion carries the slower tempo
  const dir = makeProject({ bars: 4 });
  temps.push(path.dirname(dir));
  const wav = path.join(path.dirname(dir), 'beat.wav');
  execFileSync('python3', [path.join(SKILL, 'scripts', 'click_track.py'), wav, '96', '--seconds', '30', '--swing', '0.667'], { stdio: 'pipe' });
  writeFileSync(path.join(dir, 'song.json'), JSON.stringify({ sync: { bpm: 128, checked_by_ear: '2026-10-04' } }));
  execFileSync('python3', [path.join(SKILL, 'scripts', 'analyze_song.py'), wav, '--out', dir, '--bars', '4', '--start-bar', '2'], { stdio: 'pipe' });
  const sw = songOf(dir).suggestions.swing;
  assert.ok(sw && sw.bpm != null, JSON.stringify(songOf(dir).suggestions));
  const { page, errors, state } = await open(dir);
  const row = page.locator('#suggestions .srow[data-key="swing"]');
  assert.match(await row.innerText(), new RegExp(`swing ${sw.value.toFixed(2)} and tempo ${sw.bpm.toFixed(1)}`));
  assert.equal(await state(() => window.syncState.pending.checked_by_ear), '2026-10-04');
  await row.locator('button', { hasText: 'Keep' }).click();
  const p = await state(() => window.syncState.pending);
  assert.equal(p.swing, sw.value);
  assert.equal(p.bpm, sw.bpm);
  assert.ok(!('checked_by_ear' in p), 'a kept tempo clears Sounds right');
  await saveAndWait(page, 1);
  const saved = songOf(dir).sync;
  assert.equal(saved.swing, sw.value);
  assert.equal(saved.bpm, sw.bpm);
  assert.ok(!('checked_by_ear' in saved));
  assert.deepEqual(errors, []);
});

test('sync page: a saved swing clicks its off-beats, softer and lower than the beats', async () => {
  const dir = project();
  const s = songOf(dir);
  s.sync = { ...(s.sync ?? {}), swing: 0.6 };
  writeFileSync(path.join(dir, 'song.json'), JSON.stringify(s, null, 2));
  const { page, errors, state } = await open(dir);
  const tones = await state(() => window.syncState.clickTones);
  assert.ok(tones.off.freq < tones.beat.freq && tones.off.gain < tones.beat.gain, JSON.stringify(tones));
  const ct = await state(() => window.syncState.clickTimes);
  assert.equal(ct.filter((c) => c.off).length, ct.filter((c) => !c.off).length, 'one off-beat per beat');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.syncState.clicks.some((c) => c.off), null, { timeout: 30000 });
  await page.keyboard.press('Space');
  const offs = await state(() => window.syncState.clicks.filter((c) => c.off));
  assert.ok(offs.every((c) => !Number.isInteger(c.beat) && !c.down));
  assert.deepEqual(errors, []);
});

test('sync page: Save carries the sync fields the page does not edit (tempo_map, pickup_beats, dismissed)', async () => {
  const dir = project();
  const s = songOf(dir);
  const extra = { tempo_map: [{ t: 0, bpm: 120, ramp: false }, { t: 6, bpm: 121, ramp: false }], pickup_beats: 1,
    dismissed: [{ key: 'swing', value: 0.6 }] };
  s.sync = { ...(s.sync ?? {}), ...extra };
  writeFileSync(path.join(dir, 'song.json'), JSON.stringify(s, null, 2));
  const { page, errors, state } = await open(dir);
  assert.ok(await page.locator('#suggestions').isHidden(), 'no suggestions: no list');
  await page.keyboard.press('ArrowDown');
  assert.equal(await state(() => window.syncState.dirty), true);
  await saveAndWait(page, 1);
  const saved = songOf(dir).sync;
  assert.equal(saved.nudge_ms, -5);
  assert.deepEqual(saved.tempo_map, extra.tempo_map);
  assert.equal(saved.pickup_beats, 1);
  assert.deepEqual(saved.dismissed, extra.dismissed);
  assert.deepEqual(errors, []);
});
