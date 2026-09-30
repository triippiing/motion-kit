import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, didYouMean, typeOk, matchHotspot } from '../components/core/validate.js';

const fake = (name, props = {}, hotspots = []) => ({ meta: { name, props, hotspots } });
const registry = {
  toast: fake('toast', { text: ['string', 'Saved'], icon: ['enum:check|none', 'check'] }, ['toast', 'action']),
  tabs: fake('tabs', { items: ['string[]', ['A', 'B']], active: ['string', 'A'] }, ['tab:<item>']),
  button: fake('button', { label: ['string', 'Go'] }, ['button']),
};
const song = { beats: Array.from({ length: 16 }, (_, i) => ({ i, t: i * 0.5 })), beat_sec: 0.5, rules: { min_hold_beats: 2, max_states: 8 } };
const loopOk = (rows) => [...rows, { ...rows[0], at: 14 }];
const run = (states, cursor = [{ at: 0, x: 0, y: 0 }, { at: 14, x: 0, y: 0 }], o = {}) => validate({ states, cursor, registry, song, ...o });

test('a valid table has no errors', () => {
  const r = run(loopOk([{ at: 0, use: 'button', label: 'Hi' }, { at: 4, use: 'toast', text: 'Done' }]));
  assert.deepEqual(r.errors, []);
});

test('unknown component suggests the closest name', () => {
  const r = run(loopOk([{ at: 0, use: 'tost' }]));
  assert.match(r.errors.join('\n'), /unknown component "tost".*did you mean "toast"/);
});

test('unknown prop lists the valid props', () => {
  const r = run(loopOk([{ at: 0, use: 'toast', txt: 'x' }]));
  assert.match(r.errors.join('\n'), /unknown prop "txt" for toast \(props: text, icon\)/);
});

test('wrong prop type is reported with the expected type', () => {
  const r = run(loopOk([{ at: 0, use: 'toast', icon: 'star' }]));
  assert.match(r.errors.join('\n'), /prop "icon" of toast should be enum:check\|none/);
});

test('custom rows need name, w, h, r', () => {
  const r = run(loopOk([{ at: 0, name: 'x', w: 10 }]));
  assert.match(r.errors.join('\n'), /custom row at beat 0 needs numeric w, h and r/);
  assert.match(run(loopOk([{ at: 0 }])).errors.join('\n'), /needs `use`.*or `name`/);
});

test('rows must start at 0 and ascend', () => {
  assert.match(run([{ at: 1, use: 'button' }]).errors.join('\n'), /first row must be at beat 0/);
  assert.match(run(loopOk([{ at: 0, use: 'button' }, { at: 6, use: 'toast' }, { at: 4, use: 'toast' }])).errors.join('\n'), /ascending/);
});

test('looping piece: last row must repeat the first at least 2 beats before the end', () => {
  const r = run([{ at: 0, use: 'button' }, { at: 15, use: 'button' }]);
  assert.match(r.errors.join('\n'), /at least 2 beats before the end/);
  const r2 = run([{ at: 0, use: 'button', label: 'A' }, { at: 14, use: 'button', label: 'B' }]);
  assert.match(r2.errors.join('\n'), /last row must repeat the first/);
  assert.deepEqual(run([{ at: 0, use: 'button' }, { at: 15, use: 'toast' }], undefined, { loop: false }).errors, []);
});

test('cursor targets must exist on the active or next row', () => {
  const states = loopOk([{ at: 0, use: 'button' }, { at: 4, use: 'tabs', items: ['Day', 'Month'] }]);
  const ok = run(states, [{ at: 0, x: 0, y: 0 }, { at: 3.5, target: 'tab:Month', press: true }, { at: 5, target: 'tab:Day' }, { at: 14, x: 0, y: 0 }]);
  assert.deepEqual(ok.errors, []);
  const bad = run(states, [{ at: 0, x: 0, y: 0 }, { at: 5, target: 'tab-Month' }, { at: 14, x: 0, y: 0 }]);
  assert.match(bad.errors.join('\n'), /hotspot "tab-Month" is not on tabs at beat 5 \(hotspots: tab:<item>\)/);
});

test('press down must be followed by an up', () => {
  const states = loopOk([{ at: 0, use: 'button' }]);
  const r = run(states, [{ at: 0, x: 0, y: 0 }, { at: 1, x: 0, y: 0, press: 'down' }, { at: 14, x: 0, y: 0 }]);
  assert.match(r.errors.join('\n'), /press 'down' at beat 1 has no matching 'up'/);
});

test('strict mode: holds and budget', () => {
  const r = run(loopOk([{ at: 0, use: 'button' }, { at: 1, use: 'toast' }]), undefined, { strict: true });
  assert.match(r.errors.join('\n'), /holds 1 beat; min_hold_beats is 2/);
  assert.ok(r.warnings.some((w) => /quiet beats/.test(w)));
});

test('helpers', () => {
  assert.equal(didYouMean('tost', ['toast', 'tabs']), 'toast');
  assert.equal(didYouMean('zzzzzz', ['toast']), null);
  assert.ok(typeOk('enum:a|b', 'b') && !typeOk('enum:a|b', 'c'));
  assert.ok(typeOk('string[]', ['a']) && !typeOk('string[]', [1]));
  assert.ok(matchHotspot(['tab:<item>'], 'tab:Month') && !matchHotspot(['tab:<item>'], 'tab:') && matchHotspot(['toast'], 'toast'));
});
