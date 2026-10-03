// Every script's CLI must run when invoked through a symlinked skill dir (the installed
// ~/.claude/skills/motion-video is a symlink to this repo), not silently do nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeProject } from './harness.mjs';
import { tempDir } from './tmp.mjs';

const SKILL = path.resolve(import.meta.dirname, '..');
const link = path.join(tempDir('mk-symlink-'), 'motion-video');
symlinkSync(SKILL, link);
const run = (script, args) => spawnSync('node', [path.join(link, 'scripts', script), ...args], { encoding: 'utf8' });

test('check_brief through a symlink reports a broken brief', () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), '# Motion brief\n\nnothing here\n');
  const r = run('check_brief.mjs', [dir]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /error: missing section "## Request"/);
});

test('build_catalog --check through a symlink runs', () => {
  const r = run('build_catalog.mjs', ['--check']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /catalog up to date \(\d+ components\)/);
});

test('gallery through a symlink rejects an unknown --only name', () => {
  const r = run('gallery.mjs', ['', '--only', 'nope']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--only names no known component: nope/);
});

test('render through a symlink prints usage without a DIR', () => {
  const r = run('render.mjs', []);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: render\.mjs DIR/);
});

test('beat_stills through a symlink prints usage without a DIR', () => {
  const r = run('beat_stills.mjs', []);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: beat_stills\.mjs DIR/);
});

test('safezones through a symlink prints usage without a DIR', () => {
  const r = run('safezones.mjs', []);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: safezones\.mjs DIR/);
});

test('sync through a symlink prints usage without a DIR', () => {
  const r = run('sync.mjs', []);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: sync\.mjs DIR/);
});
