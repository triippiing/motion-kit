import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const run = (dest) => spawnSync(path.join(ROOT, 'install.sh'), ['--link-only'], { env: { ...process.env, CLAUDE_SKILLS_DIR: dest }, encoding: 'utf8' });

test('links every skill and is idempotent', () => {
  const dest = mkdtempSync(path.join(tmpdir(), 'skills-'));
  for (let i = 0; i < 2; i++) assert.equal(run(dest).status, 0);
  for (const name of ['motion-design', 'motion-video', 'motion-ui']) {
    const p = path.join(dest, name);
    assert.ok(lstatSync(p).isSymbolicLink(), name);
    assert.equal(realpathSync(p), realpathSync(path.join(ROOT, 'skills', name)));
  }
});

test('refuses to replace a real directory', () => {
  const dest = mkdtempSync(path.join(tmpdir(), 'skills-'));
  mkdirSync(path.join(dest, 'motion-ui'));
  const r = run(dest);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a symlink/);
});

test('doctor passes on this machine', () => {
  execFileSync(path.join(ROOT, 'skills/motion-video/scripts/doctor.sh'), { stdio: 'pipe' });
});
