// is_main.test.mjs -- the shared "run as a script?" guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../scripts/is_main.mjs';
import { tempDir } from './tmp.mjs';

const SCRIPTS = path.join(import.meta.dirname, '..', 'scripts');

test('isMain: its own path, through a symlink, a missing path, no argv[1]', () => {
  const self = fileURLToPath(import.meta.url);
  assert.equal(isMain(import.meta.url, self), true);
  const link = path.join(tempDir('mk-ismain-'), 'link.mjs');
  symlinkSync(self, link);   // install.sh links the skills, so scripts often run through a symlink
  assert.equal(isMain(import.meta.url, link), true);
  assert.equal(isMain(import.meta.url, path.join(SCRIPTS, 'render.mjs')), false);
  assert.equal(isMain(import.meta.url, '/nope/never/x.mjs'), false);
  // node -e / stdin runs have no argv[1]; the default must then say "no". (An explicit undefined argument would
  // take the default, which under node --test is this very file.)
  const saved = process.argv[1];
  process.argv[1] = undefined;
  try { assert.equal(isMain(import.meta.url), false); } finally { process.argv[1] = saved; }
});

test('no script repeats the old realpathSync(process.argv[1]) guard', () => {
  for (const f of readdirSync(SCRIPTS).filter((n) => n.endsWith('.mjs'))) {
    assert.doesNotMatch(readFileSync(path.join(SCRIPTS, f), 'utf8'), /realpathSync\(process\.argv\[1\]\)/, f);
  }
});
