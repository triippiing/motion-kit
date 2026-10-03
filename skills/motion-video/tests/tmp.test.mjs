// tmp.test.mjs -- tempDir removes its directories when the test process ends: normally, on a crash and on SIGINT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TMP = pathToFileURL(path.join(import.meta.dirname, 'tmp.mjs')).href;
const prelude = `import { tempDir } from ${JSON.stringify(TMP)}; import { writeFileSync } from 'node:fs';`;
const args = (body) => ['--input-type=module', '-e', `${prelude}\n${body}`];
const child = (body, env = {}) => spawnSync(process.execPath, args(body), { encoding: 'utf8', env: { ...process.env, ...env } });
const MAKE = "const d = tempDir('mk-tmptest-'); writeFileSync(d + '/f', 'x'); console.log(d);";

test('a normal exit removes the directory', () => {
  const r = child(MAKE);
  assert.equal(r.status, 0, r.stderr);
  const d = r.stdout.trim();
  assert.match(path.basename(d), /^mk-tmptest-/);
  assert.equal(existsSync(d), false);
});

test('an uncaught exception still removes the directory', () => {
  const r = child(`${MAKE} throw new Error('boom');`);
  assert.equal(r.status, 1);
  assert.match(path.basename(r.stdout.trim()), /^mk-tmptest-/);
  assert.equal(existsSync(r.stdout.trim()), false);
});

test('SIGINT removes the directory and exits 130', { timeout: 20_000 }, async () => {
  const c = spawn(process.execPath, args(`${MAKE} setInterval(() => {}, 1000);`));
  let err = '';
  c.stderr.on('data', (b) => { err += b; });
  // a child that exits before printing fails the test (with its stderr) instead of hanging it
  const d = await new Promise((resolve, reject) => {
    c.stdout.once('data', (b) => resolve(String(b).trim()));
    c.once('exit', (code) => reject(new Error(`the child exited ${code} before printing: ${err}`)));
  });
  assert.equal(existsSync(d), true);
  const code = await new Promise((resolve) => { c.on('exit', (code) => resolve(code)); c.kill('SIGINT'); });
  assert.equal(code, 130);
  assert.equal(existsSync(d), false);
});

test('MK_KEEP_TMP=1 keeps the directory and names it on stderr', () => {
  const r = child(MAKE, { MK_KEEP_TMP: '1' });
  const d = r.stdout.trim();
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(d), true);
    assert.ok(r.stderr.includes(d), r.stderr);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
