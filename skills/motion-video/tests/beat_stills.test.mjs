import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beatStills } from '../scripts/beat_stills.mjs';
import { fixture } from './fixtures.mjs';

test('one still per beat plus a contact sheet', async () => {
  const r = await beatStills(fixture());
  assert.equal(r.stills.length, 4);
  for (const f of [...r.stills, r.sheet]) assert.ok(existsSync(f), f);
});

test('a looping piece passes the seam check', async () => {
  const r = await beatStills(fixture({ seek: 'const g = Math.round(128 + 100 * Math.sin(2 * Math.PI * t)); document.body.style.background = `rgb(${g},${g},${g})`;' }));
  assert.equal(r.seam.ok, true, r.seam.notes.join('; '));
});

test('a piece whose last frame differs from its first fails', async () => {
  const r = await beatStills(fixture({ seek: 'const g = Math.round(255 * t); document.body.style.background = `rgb(${g},${g},${g})`;' }));
  assert.equal(r.seam.ok, false);
  assert.match(r.seam.notes.join(' '), /frame/);
});

test('a cursor that is still moving at the seam fails', async () => {
  const dir = fixture();
  const html = readFileSync(path.join(dir, 'index.html'), 'utf8')
    .replace('return { cursor: { x: 10, y: 10 } };', 'return { cursor: { x: 10 + 40 * t * t, y: 10 } };');
  writeFileSync(path.join(dir, 'index.html'), html);
  const r = await beatStills(dir);
  assert.equal(r.seam.ok, false);
  assert.match(r.seam.notes.join(' '), /cursor/);
});
