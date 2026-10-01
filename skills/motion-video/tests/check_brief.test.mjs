import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeProject } from './harness.mjs';
import { briefCommercial, briefExports, checkBrief } from '../scripts/check_brief.mjs';   // checkBrief is async
import { pathToFileURL } from 'node:url';
import nodeModule from 'node:module';   // registerHooks is Node >= 22.15 (a named import would fail to link on the 20.11 floor)

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/check_brief.mjs');
const brief = (tables, sections = true) => `# Motion brief\n\n${sections ? '## Request\nA promo.\n\n## Decisions\n- square\n\n## Moments\n1. Import -> button\n\n' : ''}## Beat table\n\n| # | bar.beat | t | component | what changes | sound |\n|---|---|---|---|---|---|\n\n\`\`\`js\n${tables}\n\`\`\`\n`;
const good = `const states = () => [\n  { at: 0, use: 'button', label: 'Go' },\n  { at: 4, use: 'check' },\n  { at: END - 2, use: 'button', label: 'Go' },\n];\nconst cursor = () => [\n  { at: 0, x: 240, y: 280 },\n  { at: 1.5, target: 'button' },\n  { at: 2, target: 'button', press: true },\n  { at: END - 2, x: 240, y: 280 },\n];`;

test('a good brief passes', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good));
  const r = await checkBrief(dir);
  assert.deepEqual(r.errors, []);
  // Intentionally sparse: its mid-piece quiet beats are reported, the settling tail (14, 15) is not.
  assert.match(r.warnings.join('\n'), /quiet beats \(nothing starts on them\): 3, 5, 6, 7, 8, 9, 10, 11, 12, 13;/);
  assert.equal(spawnSync('node', [SCRIPT, dir]).status, 0);
});

test('```javascript fences and CRLF line endings are read', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good).replace('```js', '```javascript').replace(/\n/g, '\r\n'));
  assert.deepEqual((await checkBrief(dir)).errors, []);
});

test('section headings must be headings on their own line', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good).replace('## Request\n', 'See ## Request above\n'));
  assert.match((await checkBrief(dir)).errors.join('\n'), /missing section "## Request"/);
});

test('beat table code that never returns times out with a readable error', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(`const states = () => { for (;;) {} };\nconst cursor = () => [];`));
  assert.match((await checkBrief(dir)).errors.join('\n'), /beat table code took longer than 1 s to run/);
});

test('bad component and missing sections are errors', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good.replace("use: 'check'", "use: 'chek'"), false));
  const r = await checkBrief(dir);
  assert.match(r.errors.join('\n'), /did you mean "check"/);
  assert.match(r.errors.join('\n'), /missing section "## Request"/);
  assert.equal(spawnSync('node', [SCRIPT, dir]).status, 1);
});

test('strict holds apply', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good.replace("{ at: 4, use: 'check' }", "{ at: 1, use: 'check' }")));
  assert.match((await checkBrief(dir)).errors.join('\n'), /holds 1 beat; min_hold_beats is 2/);
});

test('no brief is a usage error', () => {
  assert.equal(spawnSync('node', [SCRIPT, makeProject({ bars: 4 })]).status, 2);
});

test('the state-plan.md worked example passes strict validation on a 7-bar 120 BPM song', async () => {
  const md = readFileSync(path.resolve(import.meta.dirname, '../../motion-design/references/state-plan.md'), 'utf8');
  const blocks = [...md.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.equal(blocks.length, 1, 'state-plan.md has exactly one ```js block');
  const dir = makeProject({ bars: 7, bpm: 120 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(blocks[0]));
  const song = JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8'));
  assert.equal(song.beats.length, 28);
  assert.equal(song.rules.min_hold_beats, 2);
  const r = await checkBrief(dir);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, [], 'the example has something starting on every beat and fits the state budget');
  const uses = new Set([...blocks[0].matchAll(/use: '([a-z-]+)'/g)].map((m) => m[1]));
  assert.ok(uses.size >= 12, `the example uses 12 library components (got ${uses.size}: ${[...uses].join(', ')})`);
});

// A launch video that ends on a different state than it starts: not a loop.
const oneOff = good.replace("{ at: END - 2, use: 'button', label: 'Go' }", "{ at: END - 2, use: 'check', label: 'Done' }")
  .replace("{ at: END - 2, x: 240, y: 280 }", "{ at: END - 2, x: 0, y: 300 }");

test('a non-looping brief fails as a loop, passes with --no-loop or "loop": false in project.json', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(oneOff));
  assert.match((await checkBrief(dir)).errors.join('\n'), /the last row must repeat the first/);
  assert.equal(spawnSync('node', [SCRIPT, dir]).status, 1);
  assert.deepEqual((await checkBrief(dir, { loop: false })).errors, []);
  const cli = spawnSync('node', [SCRIPT, dir, '--no-loop'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /brief OK \(not a loop\)/);
  const pj = path.join(dir, 'project.json');
  writeFileSync(pj, JSON.stringify({ ...JSON.parse(readFileSync(pj, 'utf8')), loop: false }));
  assert.deepEqual((await checkBrief(dir)).errors, []);
  assert.equal(spawnSync('node', [SCRIPT, dir]).status, 0);
});

test('not a loop: quiet beats run to the end (no seam tail)', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(oneOff));
  assert.match((await checkBrief(dir, { loop: false })).warnings.join('\n'), /quiet beats \(nothing starts on them\): 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15;/);
});

test('an unknown flag is a usage error', () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good));
  const r = spawnSync('node', [SCRIPT, dir, '--noloop'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option "--noloop"/);
});

test('a malformed project.json is a warning (checked as a loop), not silently ignored', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good));
  writeFileSync(path.join(dir, 'project.json'), '{ "loop": false,');
  const r = await checkBrief(dir);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join('\n'), /project\.json is not valid JSON \(.+\); checking as a loop/);
  const cli = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  assert.match(cli.stdout, /warning: project\.json is not valid JSON/);
});

test('fill and ink are checked against theme.json (house roles when it is missing)', async () => {
  const dir = makeProject({ bars: 4 });
  const pos = good.replace("{ at: 4, use: 'check' }", "{ at: 4, use: 'check', fill: 'pos' }");
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(pos));
  const tf = path.join(dir, 'theme.json');
  writeFileSync(tf, JSON.stringify({ canvas: '#eceae6', surface: '#ffffff', ink: '#0b0b0b', muted: '#8c8883', accent: '#0b0b0b', font: 'Geist' }));
  assert.match((await checkBrief(dir)).errors.join('\n'), /fill at beat 4 should be a theme role \(canvas, surface, ink, muted, accent\) or #rrggbb, got "pos"/);
  writeFileSync(tf, JSON.stringify({ canvas: '#eceae6', surface: '#ffffff', ink: '#0b0b0b', muted: '#8c8883', accent: '#0b0b0b', pos: '#1a7f37' }));
  assert.deepEqual((await checkBrief(dir)).errors, []);
  rmSync(tf);
  assert.match((await checkBrief(dir)).errors.join('\n'), /got "pos"/, 'no theme.json: the house roles');
});

test('a cursor target that does not resolve fails the brief', async () => {
  const dir = makeProject({ bars: 4 });
  const tabs = good.replace("{ at: 4, use: 'check' }", "{ at: 4, use: 'tabs', items: ['Day', 'Month'], active: 'Day' }")
    .replace("{ at: 2, target: 'button', press: true },", "{ at: 2, target: 'button', press: true },\n  { at: 5, target: 'tab:Mnoth', press: true },");
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(tabs));
  assert.match((await checkBrief(dir)).errors.join('\n'), /hotspot "tab:Mnoth" at beat 5 does not resolve on tabs at beat 5 \(it has: tab:Day, tab:Month\)/);
});

test('a stray comma in states() is a readable error', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good.replace("{ at: 4, use: 'check' },", "{ at: 4, use: 'check' },,")));
  assert.deepEqual((await checkBrief(dir)).errors, ['states() row 3 (after beat 4) is empty (a stray comma?)']);
});

test('the CLI turns a crash into one error line, exit 2 (malformed song.json, malformed theme.json)', () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good));
  writeFileSync(path.join(dir, 'theme.json'), '{ "canvas": ');
  let r = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^error: theme\.json is not valid JSON \(/);
  rmSync(path.join(dir, 'theme.json'));
  writeFileSync(path.join(dir, 'song.json'), '{ "beats": [');
  r = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^error: song\.json is not valid JSON \(/);
  assert.doesNotMatch(r.stderr, /at .*\.mjs:\d+/, 'no stack trace');
  writeFileSync(path.join(dir, 'song.json'), '{ "bpm": 120 }');
  r = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^error: song\.json has no beats list/);
});

// ---- Exports and music decisions (safe zones via safezones.mjs) ----

const decide = (md, ...lines) => md.replace('## Decisions\n- square\n', `## Decisions\n- square\n${lines.map((l) => `- ${l}\n`).join('')}`);
// A stand-in for checkSafeZones that records what it was asked and never opens a browser.
const stub = (issues = []) => {
  const calls = [];
  return { calls, fn: async (dir, opts) => { calls.push(opts); return { issues }; } };
};

test('without an Exports line no safe-zone check runs (no browser)', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good));
  const s = stub();
  assert.deepEqual((await checkBrief(dir, { safeZones: s.fn })).errors, []);
  assert.equal(s.calls.length, 0);
  // The CLI too: with Playwright pointed at an empty browsers dir any launch would fail, and it still passes.
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(dir, 'no-browsers') };
  const r = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /safe-zone/);
  // ...whereas with an Exports line that environment does reach for a browser (so the check above is real).
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), decide(brief(good), '**Exports:** reels'));
  const w = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8', env });
  assert.match(w.stdout, /warning: the safe-zone check did not run: /);
});

test('the state-plan worked example and every recipe still pass the CLI with no Exports line, and no browser', () => {
  // The planner's docs and recipes are briefs without an **Exports:** line: they must pass exactly as before, without
  // Playwright (pointed at an empty browsers dir, any launch would fail with "Executable doesn't exist").
  const read = (rel) => readFileSync(path.resolve(import.meta.dirname, rel), 'utf8');
  const plan = [...read('../../motion-design/references/state-plan.md').matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]);
  const recipes = [...read('../components/RECIPES.md').matchAll(/^### (.+)\n[\s\S]*?```js\n([\s\S]*?)```/gm)].map((m) => [m[1], m[2]]);
  assert.equal(plan.length, 1);
  assert.equal(recipes.length, 5);
  const dir = makeProject({ bars: 7, bpm: 120 });
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(dir, 'no-browsers') };
  for (const [name, code] of [['state-plan.md', plan[0]], ...recipes]) {
    const md = brief(code);
    assert.equal(briefExports(md), null, name);
    writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), md);
    const r = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8', env });
    assert.equal(r.status, 0, `${name}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stdout, 'brief OK\n', `${name}: no warnings at all (so no safe-zone or browser warning)`);
    assert.equal(r.stderr, '', name);
  }
});

test('the Exports line names presets: each issue becomes a warning; unknown names are errors', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), decide(brief(good), '**Exports:** reels, tiktok, web.').replace(/\n/g, '\r\n'));
  const s = stub([{ preset: 'reels', beat: 12, through: 12, t: 6, part: 'shape', edge: 'bottom', px: 40 },
    { preset: 'tiktok', beat: 3, through: 5.5, t: 1.5, part: 'cursor', edge: 'right', px: 7 }]);
  const r = await checkBrief(dir, { safeZones: s.fn });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(s.calls.map((c) => c.presets), [['reels', 'tiktok', 'web']]);
  assert.ok(r.warnings.includes('beat 12: shape extends 40 px into the Instagram Reels bottom zone'), r.warnings.join('\n'));
  assert.ok(r.warnings.includes('beats 3-5.5: cursor is 7 px into the TikTok right zone'), r.warnings.join('\n'));
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), decide(brief(good), '**Exports:** reelz, web'));
  const bad = await checkBrief(dir, { safeZones: stub().fn });
  assert.match(bad.errors.join('\n'), /Exports: unknown preset "reelz" \(did you mean "reels"\?\)/);
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), decide(brief(good), '**Exports:**'));
  assert.match((await checkBrief(dir, { safeZones: stub().fn })).errors.join('\n'), /Exports: names no presets/);
});

test('a commercial track with public Exports is a warning; private-only or a licensed track is not', async () => {
  const dir = makeProject({ bars: 4 });
  const song = '**Song:** "Tints", my own copy: a commercial track, so social platforms would likely mute it.';
  const run = async (...lines) => {
    writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), decide(brief(good), ...lines));
    return (await checkBrief(dir, { safeZones: stub().fn })).warnings.filter((w) => /commercial/.test(w));
  };
  assert.deepEqual(await run(song, '**Exports:** reels, discord, web'),
    ['commercial music with public exports (Instagram Reels, Web / wiki / GitHub) risks a mute or takedown: export those with --silent or use a licensed track']);
  assert.deepEqual(await run('**Music:** commercial', '**Exports:** x'), [
    'commercial music with public exports (X (square)) risks a mute or takedown: export those with --silent or use a licensed track']);
  assert.deepEqual(await run(song, '**Exports:** discord'), []);
  assert.deepEqual(await run('**Song:** a licensed stock track, not a commercial track.', '**Exports:** reels'), []);
  assert.deepEqual(await run('**Music:** non-commercial library track', '**Exports:** reels'), []);
  assert.deepEqual(await run(song), [], 'no Exports line, nothing to warn about');
});

test('briefCommercial: a commercial track, song or release is commercial; licensed or negated wording is not', () => {
  const md = (line) => `## Decisions\n- ${line}\n\n## Moments\n`;
  // demo 04's real Song line (the planner's wording) must match.
  const demo = readFileSync(path.resolve(import.meta.dirname, '../../../demos/04-library-reference/MOTION-BRIEF.md'), 'utf8');
  assert.equal(briefCommercial(demo), true, 'demo 04');
  for (const line of ['**Song:** "Tints", a commercial track', '**Music:** commercial', '**Music:** Commercial.', '**Song:** a commercial song I own',
    '**Song:** commercial release (Tints)', '**Music:** a commercial recording', '**Song:** my copy of commercial music'])
    assert.equal(briefCommercial(md(line)), true, line);
  for (const line of ['**Music:** licensed for commercial use', '**Music:** cleared for commercial use, royalty-free',
    '**Music:** no commercial restrictions', '**Music:** non commercial library', '**Music:** non-commercial library track',
    '**Song:** not-commercial', "**Song:** this isn't commercial", '**Song:** isn’t a commercial track', '**Song:** is not a commercial track',
    '**Song:** not  commercial', '**Song:** not a commercial track', '**Music:** stock track with a commercial licence',
    '**Music:** commercial-free library', '**Music:** we hold commercial rights', '**Music:** commercial license included'])
    assert.equal(briefCommercial(md(line)), false, line);
  assert.equal(briefCommercial('## Request\na commercial track\n\n## Decisions\n- **Song:** licensed\n'), false, 'only Decisions counts');
});

test('an Exports typo is reported even when the beat table code does not run', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), decide(brief('const states = () => { throw new Error("boom"); };\nconst cursor = () => [];'), '**Exports:** reelz'));
  const r = await checkBrief(dir, { safeZones: stub().fn });
  assert.match(r.errors.join('\n'), /beat table code does not run: boom/);
  assert.match(r.errors.join('\n'), /Exports: unknown preset "reelz"/);
});

test('without an Exports line check_brief loads neither render.mjs nor Playwright',
  { skip: typeof nodeModule.registerHooks === 'function' ? false : 'needs Node >= 22.15' }, () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good));
  const code = `import { registerHooks } from 'node:module';
const seen = [];
registerHooks({ resolve(s, c, next) { const r = next(s, c); seen.push(r.url); return r; } });
const { checkBrief } = await import(${JSON.stringify(pathToFileURL(SCRIPT).href)});
const r = await checkBrief(${JSON.stringify(dir)});
console.log(JSON.stringify({ errors: r.errors, loaded: seen.filter((u) => /playwright|render\.mjs|safezones\.mjs/.test(u)) }));`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), { errors: [], loaded: [] });
});

test('an Exports line runs the safe-zone check on the brief\'s own tables (not index.html\'s)', async () => {
  const dir = makeProject({ bars: 4 });
  // The template's index.html still has its default rows; the brief makes the check row 700 px tall.
  const tall = good.replace("{ at: 4, use: 'check' }", "{ at: 4, use: 'check', w: 300, h: 700 }")
    .replace(/x: 240, y: 280/g, 'x: 0, y: 0');
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), decide(brief(tall), '**Exports:** reels'));
  const r = await checkBrief(dir);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /^beats 4\.5-\d+(\.5)?: shape extends \d+ px into the Instagram Reels bottom zone$/.test(w)), r.warnings.join('\n'));
});

test('a one-off brief (--no-loop) with Exports is safe-zone checked as a one-off too', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), decide(brief(oneOff), '**Exports:** reels'));
  const r = await checkBrief(dir, { loop: false });
  assert.deepEqual(r.errors, []);
  assert.ok(!r.warnings.some((w) => /did not run/.test(w)), r.warnings.join('\n'));
});
