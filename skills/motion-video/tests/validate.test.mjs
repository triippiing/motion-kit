import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, didYouMean, typeOk, matchHotspot, targetRow, pressRow, markerMessage } from '../components/core/validate.js';
import { markerBeat, resolveRows } from '../components/core/timing.js';

// Fakes with real geometry/hotspot: a hotspot resolves when its name matches (tabs: only its own items).
const fake = (name, props = {}, hotspots = [], drag, hotspot) => ({ meta: { name, props, hotspots, ...(drag ? { drag } : {}) },
  geometry: () => ({ w: 200, h: 100, r: 20, fill: 'surface', ink: 'ink' }),
  hotspot: hotspot ?? ((h) => (matchHotspot(hotspots, h) ? { x: 0, y: 0 } : null)) });
const registry = {
  toast: fake('toast', { text: ['string', 'Saved'], icon: ['enum:check|none', 'check'] }, ['toast', 'action']),
  tabs: fake('tabs', { items: ['string[]', ['A', 'B']], active: ['string', 'A'] }, ['tab:<item>'], undefined,
    (h, p) => (h.startsWith('tab:') && p.items.includes(h.slice(4)) ? { x: 0, y: 0 } : null)),
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

// ---- hotspots must resolve with the row's real props (the library's own components)
import { registry as lib } from '../components/index.js';
const libRun = (states, cursor, o = {}) => validate({ states: loopOk(states), cursor: [{ at: 0, x: 0, y: 0 }, ...cursor, { at: 14, x: 0, y: 0 }], registry: lib, song, ...o });
const missed = (states, cursor) => libRun(states, cursor).errors.join('\n');

test('a hotspot that names no real item is an error listing what the row has', () => {
  assert.match(missed([{ at: 0, use: 'tabs', items: ['Day', 'Week', 'Month'] }], [{ at: 2, target: 'tab:Mnoth' }]),
    /hotspot "tab:Mnoth" at beat 2 does not resolve on tabs at beat 2 \(it has: tab:Day, tab:Week, tab:Month\): did you mean "tab:Month"\?/);
  assert.match(missed([{ at: 0, use: 'list' }], [{ at: 2, target: 'row:9' }]), /"row:9" at beat 2 does not resolve on list at beat 2 \(it has: row:0 to row:2\)/);
  assert.match(missed([{ at: 0, use: 'line-chart' }], [{ at: 2, target: 'point:12' }]), /"point:12" .* on line-chart at beat 2 \(it has: point:0 to point:7\)/);
  assert.match(missed([{ at: 0, use: 'calendar' }], [{ at: 2, target: 'day:8' }]), /"day:8" .* on calendar at beat 2 \(it has: day:1 to day:7\)/);
  assert.match(missed([{ at: 0, use: 'dropdown', open: false }], [{ at: 2, target: 'item:Oldest' }]), /"item:Oldest" .* on dropdown at beat 2 \(it has: trigger\)/);
  assert.match(missed([{ at: 0, use: 'toast', text: 'Saved' }], [{ at: 2, target: 'action' }]), /"action" .* on toast at beat 2 \(it has: toast\)/);
  // An open dropdown lists its items.
  assert.match(missed([{ at: 0, use: 'dropdown', open: true }], [{ at: 2, target: 'item:Nope' }]), /\(it has: trigger, item:Newest, item:Oldest, item:Popular\)/);
});

test('a cursor row aims at the first candidate row on which its hotspot resolves', () => {
  // The dropdown at beat 0 is closed; the one starting at beat 4 is open: item:Oldest at 3.5 is on the next row.
  const states = loopOk([{ at: 0, use: 'dropdown' }, { at: 4, use: 'dropdown', open: true }, { at: 8, use: 'button' }]);
  const rows = states.map((row) => ({ row, comp: lib[row.use] }));
  assert.equal(targetRow(rows, { at: 3.5, target: 'item:Oldest' }), rows[1]);
  assert.equal(pressRow(rows, { at: 3.5, target: 'item:Oldest', press: true }), rows[1]);
  assert.equal(targetRow(rows, { at: 3.5, target: 'trigger' }), rows[0], 'both resolve: the active row wins');
  assert.equal(targetRow(rows, { at: 2, target: 'item:Oldest' }), null, 'the next row is too far ahead');
  assert.deepEqual(validate({ states, cursor: [{ at: 0, x: 0, y: 0 }, { at: 3.5, target: 'item:Oldest', press: true }, { at: 14, x: 0, y: 0 }], registry: lib, song }).errors, []);
  // Two tabs rows with different items: a drag on 'Year' (only on the row at beat 4) stays inside that row.
  const t = libRun([{ at: 0, use: 'tabs' }, { at: 4, use: 'tabs', items: ['Month', 'Year'], active: 'Month' }, { at: 8, use: 'button' }],
    [{ at: 3.5, target: 'tab:Year', press: 'down' }, { at: 3.7, target: 'tab:Year', dx: 0, press: 'up' }]);
  assert.deepEqual(t.errors, []);
});

test('fill and ink must be a theme role or #rrggbb when a theme is given', () => {
  const theme = { canvas: '#eceae6', surface: '#ffffff', ink: '#0b0b0b', muted: '#8c8883', accent: '#0b0b0b', font: 'Geist' };
  const bad = run(loopOk([{ at: 0, use: 'button', fill: 'accnet', ink: 'pos' }]), undefined, { theme }).errors.join('\n');
  assert.match(bad, /fill at beat 0 should be a theme role \(canvas, surface, ink, muted, accent\) or #rrggbb, got "accnet"/);
  assert.match(bad, /ink at beat 0 should be a theme role .* got "pos"/, 'pos is a role only when the theme defines it');
  assert.match(run(loopOk([{ at: 0, use: 'button', fill: 'font' }]), undefined, { theme }).errors.join('\n'), /got "font"/, 'a non-colour key is not a role');
  assert.deepEqual(run(loopOk([{ at: 0, use: 'button', fill: 'accent', ink: '#A0b0C0' }]), undefined, { theme }).errors, []);
  assert.deepEqual(run(loopOk([{ at: 0, use: 'button', ink: 'pos' }]), undefined, { theme: { ...theme, pos: '#1a7f37' } }).errors, []);
  assert.match(run(loopOk([{ at: 0, name: 'x', w: 10, h: 10, r: 2, fill: 3 }]), undefined, { theme }).errors.join('\n'), /fill at beat 0 .* got 3/);
});

test('w, h and r overrides must be finite numbers >= 0', () => {
  for (const [k, v, shown] of [['w', -5, '-5'], ['h', Infinity, 'Infinity'], ['r', '20', '"20"'], ['w', NaN, 'NaN']]) {
    const e = run(loopOk([{ at: 0, use: 'button', [k]: v }])).errors.join('\n');
    assert.match(e, new RegExp(`${k} at beat 0 should be a number >= 0, got ${shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
  assert.deepEqual(run(loopOk([{ at: 0, use: 'button', w: 300, h: 0, r: 12 }])).errors, []);
  const custom = run([{ at: 0, name: 'x', w: 10, h: -1, r: 2 }], undefined, { loop: false }).errors;
  assert.deepEqual(custom, ['h at beat 0 should be a number >= 0, got -1'], 'one message for one bad value');
});

test('holes, non-object rows and non-numeric beats are readable errors, not crashes', () => {
  // eslint-disable-next-line no-sparse-arrays
  const holes = run([{ at: 0, use: 'button' }, , { at: 14, use: 'button' }]);
  assert.deepEqual(holes.errors, ['states() row 2 (after beat 0) is empty (a stray comma?)']);
  assert.match(run([null, { at: 14, use: 'button' }]).errors.join('\n'), /states\(\) row 1 should be an object like \{ at: 4, \.\.\. \}, got null/);
  assert.match(run([{ at: 0, use: 'button' }, 'toast']).errors.join('\n'), /states\(\) row 2 \(after beat 0\) should be an object .* got "toast"/);
  // A string `at` is read as a marker name; a number in quotes gets the hint to write the number.
  assert.match(run([{ at: '0', use: 'button' }]).errors.join('\n'), /states\(\) row 1: at: '0' is not a marker: markers start with a letter \(for beat 0 write at: 0\)/);
  assert.match(run([{ at: null, use: 'button' }]).errors.join('\n'), /states\(\) row 1 needs a numeric `at` \(a beat\), got null/);
  assert.match(run(loopOk([{ at: 0, use: 'button' }]), [{ at: 0, x: 0, y: 0 }, { at: NaN, x: 0, y: 0 }, { at: 14, x: 0, y: 0 }]).errors.join('\n'),
    /cursor\(\) row 2 \(after beat 0\) needs a numeric `at` \(a beat\), got NaN/);
  // eslint-disable-next-line no-sparse-arrays
  assert.match(run(loopOk([{ at: 0, use: 'button' }]), [{ at: 0, x: 0, y: 0 }, , { at: 14, x: 0, y: 0 }]).errors.join('\n'), /cursor\(\) row 2 \(after beat 0\) is empty/);
});

test('identical messages are reported once', () => {
  const r = run(loopOk([{ at: 0, use: 'button' }]), [{ at: 0, x: 0, y: 0 }, { at: 1, target: 'nope' }, { at: 2, target: 'nope' }, { at: 3, zz: 1, x: 0, y: 0 }, { at: 3, zz: 1, x: 0, y: 0 }, { at: 14, x: 0, y: 0 }]);
  const e = r.errors;
  assert.equal(e.length, new Set(e).size);
  assert.equal(e.filter((x) => /unknown cursor key "zz" at beat 3/.test(x)).length, 1);
});

test('strict: a selection naming a value not in its list warns (meta.choices)', () => {
  const warn = (row) => libRun([row], [], { strict: true }).warnings.filter((w) => /is not one of its/.test(w));
  assert.match(warn({ at: 0, use: 'tabs', active: 'Mnoth', items: ['Day', 'Month'] }).join('\n'), /active "Mnoth" of tabs at beat 0 is not one of its items \(Day, Month\): did you mean "Month"\?/);
  assert.match(warn({ at: 0, use: 'dropdown', selected: 'Latest' }).join('\n'), /selected "Latest" of dropdown at beat 0 is not one of its items/);
  assert.match(warn({ at: 0, use: 'dock', active: 'Home' }).join('\n'), /active "Home" of dock/);
  assert.match(warn({ at: 0, use: 'chip-row', selected: ['All', 'Bils'] }).join('\n'), /selected "Bils" of chip-row at beat 0 is not one of its chips .*did you mean "Bills"/);
  assert.deepEqual(warn({ at: 0, use: 'dropdown', selected: '' }), [], 'an empty selection means none');
  assert.deepEqual(warn({ at: 0, use: 'tabs', active: 'Week' }), []);
  assert.deepEqual(libRun([{ at: 0, use: 'tabs', active: 'Mnoth' }], []).warnings, [], 'strict only');
});

// Markers: the song's derived top-level list (t in loop seconds). 'drop' sits at beat 9.37.
const msong = { ...song, markers: [{ name: 'drop', song_t: 20.685, t: 4.685, in_loop: true }, { name: 'end', song_t: 23, t: 7, in_loop: true },
  { name: 'outro', song_t: 72.31, t: 68.31, in_loop: false }] };
const mrun = (states, cursor, o = {}) => run(states, cursor, { song: msong, ...o });

test('markers: at: name and offset resolve to exact beats; holds, quiet beats and the seam use them', () => {
  assert.ok(Math.abs(markerBeat(msong, 'drop') - 9.37) < 1e-9);
  const states = loopOk([{ at: 0, use: 'button' }, { at: 4, use: 'toast' }, { at: 'drop', use: 'tabs' }]);
  // Something starts on every beat, except 8 and 9: the cursor row at drop - 0.5 (8.87) and the tabs row (9.37).
  const cursor = [...[0, 1, 2, 3, 4, 5, 6, 7].map((b) => ({ at: b, x: b % 2, y: 0 })), { at: 'drop', offset: -0.5, target: 'tab:A' },
    ...[10, 11, 12, 13].map((b) => ({ at: b, x: b % 2, y: 0 })), { at: 14, x: 0, y: 0 }];
  assert.deepEqual(mrun(states, cursor, { strict: true }), { errors: [], warnings: [] });
  // Holds are measured on the resolved beats (5.37 - 4 = 1.37).
  const short = mrun(loopOk([{ at: 0, use: 'button' }, { at: 4, use: 'toast' }, { at: 'drop', offset: -4, use: 'tabs' }]), undefined, { strict: true });
  assert.match(short.errors.join('\n'), /row at beat 4 \(toast\) holds 1\.37 beats; min_hold_beats is 2/);
  // A last row placed by marker still repeats the first (its marker name is not part of the comparison).
  assert.deepEqual(mrun([{ at: 0, use: 'button' }, { at: 4, use: 'toast' }, { at: 'end', use: 'button' }],
    [{ at: 0, x: 0, y: 0 }, { at: 'end', x: 0, y: 0 }]).errors, []);
});

test('markers: unknown, out-of-loop and non-name markers are errors with the row number, reported once', () => {
  const r = mrun(loopOk([{ at: 0, use: 'button' }, { at: 4, use: 'toast' }, { at: 'drp', use: 'tabs' }]),
    [{ at: 0, x: 0, y: 0 }, { at: 'outro', x: 0, y: 0 }, { at: '4', x: 0, y: 0 }, { at: 14, x: 0, y: 0 }]);
  assert.deepEqual(r.errors, [
    "states() row 3: unknown marker 'drp' (did you mean 'drop'?)",
    "cursor() row 2: marker 'outro' is outside the loop (at 1:12 in the song)",
    "cursor() row 3: at: '4' is not a marker: markers start with a letter (for beat 4 write at: 4)",
  ]);
  // No markers at all (song.json without a sync section): the message says so.
  assert.match(run(loopOk([{ at: 0, use: 'button' }, { at: 'drop', use: 'toast' }])).errors.join('\n'),
    /states\(\) row 2: unknown marker 'drop' \(song\.json has no markers/);
  assert.match(mrun(loopOk([{ at: 0, use: 'button' }, { at: 'zzzzzz', use: 'toast' }])).errors.join('\n'),
    /unknown marker 'zzzzzz' \(markers: drop, end, outro\)/);
});

test('markers: offset needs a marker and a number', () => {
  const r = mrun(loopOk([{ at: 0, use: 'button' }, { at: 4, offset: 1, use: 'toast' }, { at: 'drop', offset: 'x', use: 'tabs' }]));
  assert.deepEqual(r.errors, [
    "states() row 3: offset for marker 'drop' should be a number of beats, got \"x\"",
  ]);
  const n = mrun(loopOk([{ at: 0, use: 'button' }, { at: 4, offset: 1, use: 'toast' }]), [{ at: 0, x: 0, y: 0 }, { at: 2, offset: 1, x: 0, y: 0 }, { at: 14, x: 0, y: 0 }]);
  assert.deepEqual(n.errors, [
    'offset at beat 4 only goes with a marker, e.g. { at: \'drop\', offset: -0.5 }',
    'offset at beat 2 only goes with a marker, e.g. { at: \'drop\', offset: -0.5 }',
  ]);
});

test('markerMessage formats resolveRows errors (the one wording, shared with the engine)', () => {
  const song2 = { ...song, markers: [{ name: 'drop', song_t: 72.31, t: 60, in_loop: false }] };
  const [e] = resolveRows([{ at: 'drop' }], song2).errors;
  assert.equal(markerMessage(e, 'states()'), "states() row 1: marker 'drop' is outside the loop (at 1:12 in the song)");
});

test('marker names and hotspot names are separate: a target named like a marker is still a hotspot', () => {
  const r = mrun(loopOk([{ at: 0, use: 'button' }]), [{ at: 0, x: 0, y: 0 }, { at: 2, target: 'drop' }, { at: 14, x: 0, y: 0 }]);
  assert.match(r.errors.join('\n'), /hotspot "drop" is not on button/);
});

test('messages round a marker row\'s beat and name the marker', () => {
  // drop + 0.1 resolves to 9.469999999999999 in floating point; the message prints 9.47 ('drop').
  const r = mrun(loopOk([{ at: 0, use: 'button' }, { at: 'drop', offset: 0.1, use: 'toast', w: -1 }]),
    [{ at: 0, x: 0, y: 0 }, { at: 'drop', offset: 0.1, press: 'sideways', x: 0, y: 0 }, { at: 14, x: 0, y: 0 }]);
  assert.deepEqual(r.errors, ["w at beat 9.47 ('drop') should be a number >= 0, got -1", "press at beat 9.47 ('drop') should be true, 'down' or 'up'"]);
});
