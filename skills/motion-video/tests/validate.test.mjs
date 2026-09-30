import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, didYouMean, typeOk, matchHotspot } from '../components/core/validate.js';

const fake = (name, props = {}, hotspots = [], drag) => ({ meta: { name, props, hotspots, ...(drag ? { drag } : {}) } });
const registry = {
  toast: fake('toast', { text: ['string', 'Saved'], icon: ['enum:check|none', 'check'] }, ['toast', 'action']),
  tabs: fake('tabs', { items: ['string[]', ['A', 'B']], active: ['string', 'A'] }, ['tab:<item>']),
  button: fake('button', { label: ['string', 'Go'] }, ['button']),
  slider: fake('slider', { value: ['number', 0.4] }, ['thumb', 'track'], ['thumb']),
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

test('strict mode: the tail after the last row is never a quiet beat', () => {
  const states = loopOk([{ at: 0, use: 'button' }, { at: 4, use: 'toast' }]);
  const dense = [...Array.from({ length: 14 }, (_, b) => ({ at: b, x: b % 2, y: 0 })), { at: 14, x: 0, y: 0 }];
  dense[0] = { at: 0, x: 0, y: 0 };
  assert.deepEqual(run(states, dense, { strict: true }).warnings, []);
  const sparse = run(states, undefined, { strict: true }).warnings.find((w) => /quiet beats/.test(w));
  assert.match(sparse, /quiet beats \(nothing starts on them\): 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13;/);
});

test('helpers', () => {
  assert.equal(didYouMean('tost', ['toast', 'tabs']), 'toast');
  assert.equal(didYouMean('zzzzzz', ['toast']), null);
  assert.ok(typeOk('enum:a|b', 'b') && !typeOk('enum:a|b', 'c'));
  assert.ok(typeOk('string[]', ['a']) && !typeOk('string[]', [1]));
  assert.ok(matchHotspot(['tab:<item>'], 'tab:Month') && !matchHotspot(['tab:<item>'], 'tab:') && matchHotspot(['toast'], 'toast'));
});

test('loop seam ignores key order and explicitly written defaults', () => {
  const r = run([{ at: 0, use: 'toast', text: 'Saved' }, { at: 4, use: 'button' }, { icon: 'check', use: 'toast', at: 14 }]);
  assert.deepEqual(r.errors, []);
  const r2 = run([{ at: 0, use: 'toast' }, { at: 14, use: 'toast', text: 'Other' }]);
  assert.match(r2.errors.join('\n'), /last row must repeat the first/);
});

test('an inherited property name is an unknown prop, not a crash', () => {
  const r = run(loopOk([{ at: 0, use: 'toast', constructor: 'x' }]));
  assert.match(r.errors.join('\n'), /unknown prop "constructor" for toast/);
});

test('targets on an unknown component give no second, misleading hotspot error', () => {
  const r = run(loopOk([{ at: 0, use: 'tost' }]), [{ at: 0, x: 0, y: 0 }, { at: 1, target: 'toast' }, { at: 14, x: 0, y: 0 }]);
  assert.match(r.errors.join('\n'), /unknown component "tost"/);
  assert.doesNotMatch(r.errors.join('\n'), /hotspot|cursor target/);
});

test('a missed target lists both rows when the next row starts within a beat', () => {
  const states = loopOk([{ at: 0, use: 'button' }, { at: 4, use: 'tabs' }]);
  const r = run(states, [{ at: 0, x: 0, y: 0 }, { at: 3.5, target: 'nope' }, { at: 14, x: 0, y: 0 }]);
  assert.match(r.errors.join('\n'), /hotspot "nope" is not on button at beat 3\.5 \(hotspots: button\) or on tabs starting at beat 4 \(hotspots: tab:<item>\)/);
});

test('a drag must stay inside one row', () => {
  const states = loopOk([{ at: 0, use: 'button' }, { at: 4, use: 'toast' }]);
  const bad = run(states, [{ at: 0, x: 0, y: 0 }, { at: 3, x: 0, y: 0, press: 'down' }, { at: 5, x: 9, y: 0, press: 'up' }, { at: 14, x: 0, y: 0 }]);
  assert.match(bad.errors.join('\n'), /drag from beat 3 to 5 crosses a state change at beat 4; keep drags inside one row/);
  const ok = run(states, [{ at: 0, x: 0, y: 0 }, { at: 1, x: 0, y: 0, press: 'down' }, { at: 2, x: 9, y: 0 }, { at: 3, x: 9, y: 0, press: 'up' }, { at: 14, x: 0, y: 0 }]);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.warnings, []);
});

const NEVER_MOVES = /drag from beat 1 to 3 never moves: add a cursor row between the press 'down' and the 'up' that moves the cursor \(the 'up' row's own move starts only after the release\)/;
const UP_MOVES = /press 'up' at beat 3 also moves the cursor/;
const dragStates = loopOk([{ at: 0, use: 'slider' }, { at: 4, use: 'button' }]);

test('a slider thumb drag whose only move is on the up row warns, strict or not', () => {
  const cur = [{ at: 0, x: 0, y: 0 }, { at: 1, target: 'thumb', press: 'down' }, { at: 3, target: 'thumb', dx: 40, press: 'up' }, { at: 14, x: 0, y: 0 }];
  for (const strict of [false, true]) {
    const r = run(dragStates, cur, { strict });
    assert.deepEqual(r.errors, []);
    assert.ok(r.warnings.some((w) => NEVER_MOVES.test(w)), r.warnings.join('\n'));
    assert.ok(r.warnings.some((w) => UP_MOVES.test(w)), r.warnings.join('\n'));
  }
});

test('a thumb drag with a row between that does not change position warns', () => {
  const cur = [{ at: 0, x: 0, y: 0 }, { at: 1, target: 'thumb', press: 'down' }, { at: 2, target: 'thumb', sound: 'key' }, { at: 3, target: 'thumb', press: 'up' }, { at: 14, x: 0, y: 0 }];
  const r = run(dragStates, cur);
  assert.ok(r.warnings.some((w) => NEVER_MOVES.test(w)), r.warnings.join('\n'));
  assert.ok(!r.warnings.some((w) => UP_MOVES.test(w)));
});

test('a thumb drag with a move row between and a still up row is clean', () => {
  for (const move of [{ dx: 40 }, { dy: -10 }, { target: 'track' }]) {
    const mid = { at: 2, target: 'thumb', ...move };
    const cur = [{ at: 0, x: 0, y: 0 }, { at: 1, target: 'thumb', press: 'down' }, mid, { ...mid, at: 3, press: 'up' }, { at: 14, x: 0, y: 0 }];
    const r = run(dragStates, cur);
    assert.deepEqual(r.errors, [], JSON.stringify(move));
    assert.deepEqual(r.warnings, [], JSON.stringify(move));
  }
});

test('an explicit dx: 0 is the same position as no dx', () => {
  const cur = [{ at: 0, x: 0, y: 0 }, { at: 1, target: 'thumb', press: 'down' }, { at: 2, target: 'thumb', dx: 0 }, { at: 3, target: 'thumb', dx: 0, press: 'up' }, { at: 14, x: 0, y: 0 }];
  const r = run(dragStates, cur);
  assert.ok(r.warnings.some((w) => NEVER_MOVES.test(w)));
  assert.ok(!r.warnings.some((w) => UP_MOVES.test(w)));
});

test('a press-and-hold on a hotspot that is not a drag hotspot stays silent', () => {
  const states = loopOk([{ at: 0, use: 'button' }, { at: 4, use: 'slider' }]);
  const held = run(states, [{ at: 0, x: 0, y: 0 }, { at: 1, target: 'button', press: 'down' }, { at: 3, target: 'button', press: 'up' }, { at: 14, x: 0, y: 0 }], { strict: true });
  assert.deepEqual(held.errors, []);
  assert.ok(!held.warnings.some((w) => /never moves|also moves/.test(w)), held.warnings.join('\n'));
  // The slider's track is a hotspot but not a drag one.
  const track = run(dragStates, [{ at: 0, x: 0, y: 0 }, { at: 1, target: 'track', press: 'down' }, { at: 3, target: 'track', dx: 20, press: 'up' }, { at: 14, x: 0, y: 0 }]);
  assert.deepEqual(track.warnings, []);
});

test('untargeted presses and custom rows stay silent', () => {
  const xy = [{ at: 0, x: 0, y: 0 }, { at: 1, x: 5, y: 5, press: 'down' }, { at: 3, x: 50, y: 5, press: 'up' }, { at: 14, x: 0, y: 0 }];
  assert.deepEqual(run(dragStates, xy).warnings, []);
  const custom = loopOk([{ at: 0, name: 'card', w: 100, h: 100, r: 10 }, { at: 4, use: 'button' }]);
  assert.deepEqual(run(custom, xy).warnings, []);
});

test('an inherited name is an unknown component, not a crash', () => {
  const r = run(loopOk([{ at: 0, use: 'constructor' }]));
  assert.match(r.errors.join('\n'), /unknown component "constructor"/);
});

test('a look-ahead drag reports the state change it actually crosses', () => {
  const cur = [{ at: 0, x: 0, y: 0 }, { at: 3.5, target: 'tab:A', press: 'down' }, { at: 3.8, x: 0, y: 0, press: 'up' }];
  const looped = run(loopOk([{ at: 0, use: 'button' }, { at: 4, use: 'tabs' }]), [...cur, { at: 14, x: 0, y: 0 }]);
  assert.match(looped.errors.join('\n'), /drag from beat 3\.5 to 3\.8 crosses a state change at beat 4; keep drags inside one row/);
  let r;
  assert.doesNotThrow(() => { r = run([{ at: 0, use: 'button' }, { at: 4, use: 'tabs' }], cur, { loop: false }); });
  assert.match(r.errors.join('\n'), /drag from beat 3\.5 to 3\.8 crosses a state change at beat 4; keep drags inside one row/);
});
