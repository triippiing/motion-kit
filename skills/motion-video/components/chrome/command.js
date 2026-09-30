// command.js -- a command palette: a search field that types a query and a list that filters as it types.
import { el, frame, icon, fade, applyFade, pressesOn, loopPeriod } from '../core/helpers.js';

export const meta = {
  name: 'command', group: 'chrome',
  useWhen: 'An app is driven from the keyboard: jump to a page, run an action, find a setting.',
  motion: "The query types in one character every perChar beats from typeAt (beats after the row starts; -1 shows it at once), with a key sound each, like input. The rows filter live (case-insensitive): rows that stop matching collapse and the rest slide up; rows that match again reopen, and when nothing matches a muted 'No results' line fades in. The selected row (an index among the visible rows) has a soft accent background that stays on that visible slot as the list filters; a press on `row:<i>` selects the i-th visible row. A following command row continues from the typed query (a query that extends it types on; any other query replaces it on arrival, the rows springing to the new filter) and the selected row (write it as its `selected`); with the same query a blinking caret keeps blinking. At most 5 items show. The palette keeps its full height while filtering; to shrink it, follow with a command row that sets `h` (96 + visible rows * 80 + 24).",
  props: { items: ['string[]', ['Export report', 'Export CSV', 'Invite teammate', 'New goal', 'Settings']], query: ['string', ''], typeAt: ['number', -1], perChar: ['number', 0.25], selected: ['number', 0] },
  hotspots: ['field', 'row:<i>'],
  hotspotExample: { 'row:<i>': 'row:0' },
  sounds: ['key'],
  example: "{ at: 0, use: 'command', query: 'o', typeAt: 0.25 }",
  edgeCases: [{ query: '' }, { query: 'zzz', typeAt: -1 }, { items: ['Settings', 'Sign out'], query: 's', selected: 1 }, { items: ['A very long command name that goes on and on past the edge', 'Short'], query: '' }],
};

const W = 900, TOP = 96, ROW = 80, MAX = 5, PAD = 36;
const shown = (p) => p.items.slice(0, MAX);
const matches = (item, q) => item.toLowerCase().includes(q.toLowerCase());

export function geometry(p) {
  return { w: W, h: TOP + Math.min(MAX, p.items.length) * ROW + 24, r: 32, fill: 'surface', ink: 'ink' };
}

export function mount(root, p, ctx) {
  const f = frame(root, 'cm', W, ctx.geo.h, true);
  const head = el(f, 'div', { class: 'cm-head' });
  Object.assign(head.style, { position: 'absolute', left: '0', top: '0', width: `${W}px`, height: `${TOP}px` });
  Object.assign(icon(head, 'command', 32).style, { position: 'absolute', left: `${PAD}px`, top: `${(TOP - 32) / 2}px`, color: 'var(--muted)' });
  const field = el(head, 'div', { class: 'cm-field' });
  Object.assign(field.style, { position: 'absolute', left: `${PAD + 32 + 20}px`, right: '140px', top: '0', height: `${TOP}px`, display: 'grid', alignItems: 'center',
    font: '400 28px var(--font)', overflow: 'hidden', whiteSpace: 'nowrap' });
  const cell = { gridArea: '1 / 1', display: 'flex', alignItems: 'center' };
  Object.assign(el(field, 'span', { class: 'cm-ph' }, 'Type a command').style, cell, { color: 'var(--muted)' });
  const typed = el(field, 'span', { class: 'cm-typed' });
  Object.assign(typed.style, cell);
  el(typed, 'span', { class: 'cm-text' });
  Object.assign(el(typed, 'span', { class: 'cm-caret' }).style, { width: '2px', height: '34px', marginLeft: '2px', background: 'var(--accent)' });
  Object.assign(el(head, 'div', { class: 'cm-hint' }, '⌘K').style, { position: 'absolute', right: `${PAD}px`, top: `${(TOP - 40) / 2}px`, height: '40px', padding: '0 12px',
    borderRadius: '10px', border: '2px solid color-mix(in srgb, var(--muted) 35%, transparent)', color: 'var(--muted)', font: '500 22px var(--font)', lineHeight: '36px', boxSizing: 'border-box' });
  Object.assign(el(f, 'div', { class: 'cm-rule' }).style, { position: 'absolute', left: '0', top: `${TOP - 1}px`, width: `${W}px`, height: '2px',
    background: 'color-mix(in srgb, var(--muted) 20%, transparent)' });
  Object.assign(el(f, 'div', { class: 'cm-empty' }, 'No results').style, { position: 'absolute', left: `${12 + 24}px`, top: `${TOP + 12}px`, height: `${ROW}px`,
    font: '400 28px var(--font)', lineHeight: `${ROW}px`, color: 'var(--muted)' });
  shown(p).forEach((it) => {
    const r = el(f, 'div', { class: 'cm-row', 'data-item': it });
    Object.assign(r.style, { position: 'absolute', left: '12px', width: `${W - 24}px`, overflow: 'hidden', borderRadius: '20px' });
    Object.assign(el(r, 'div', { class: 'cm-label' }, it).style, { position: 'absolute', left: '24px', right: '24px', top: '0', height: `${ROW}px`,
      font: '400 28px var(--font)', lineHeight: `${ROW}px`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
  });
}

// Characters carried over from the previous row (its query is a prefix of this one); a different query shows at once.
const kept = (p, ctx) => (ctx.continues && p.query.startsWith(ctx.prev.query) ? ctx.prev.query.length : 0);
const keyBeats = (p, ctx) => (p.typeAt < 0 ? [] : [...p.query.slice(kept(p, ctx))].map((_, j) => ctx.row.at + p.typeAt + j * p.perChar));

// When each character of the query shows (seconds; -Infinity: from the start).
function times(p, ctx) {
  const keep = kept(p, ctx), typed = keyBeats(p, ctx).map((b) => ctx.t0 + ctx.beatT(b) - ctx.beatT(ctx.row.at));
  return [...Array(keep).fill(-Infinity), ...typed, ...Array(p.query.length - keep - typed.length).fill(-Infinity)];
}

// A continuation whose query does not extend the previous one replaces it on arrival.
const replaces = (p, ctx) => ctx.continues && !p.query.startsWith(ctx.prev.query);

// Everything that changes the list, in time order: the query at the start (the previous row's when this row
// replaces it, so the rows spring to the new filter at t0 instead of snapping), each character, each press on a row.
function events(p, ctx) {
  const tm = times(p, ctx), sel0 = ctx.continues ? ctx.prev.selected : p.selected, n0 = tm.filter((x) => x === -Infinity).length;
  const out = [replaces(p, ctx) ? { t: -Infinity, n: 0, q: ctx.prev.query, sel: sel0 } : { t: -Infinity, n: n0, sel: sel0 }];
  const later = [...tm.filter((x) => x > -Infinity).map((x) => ({ t: x, kind: 'key' })),
    ...pressesOn(ctx, 'row').filter((x) => x.kind !== 'up').map((x) => ({ t: x.t, kind: 'sel', sel: Number(x.hotspot.slice(4)) }))];
  if (replaces(p, ctx)) later.push({ t: ctx.t0, kind: 'query' });
  if (ctx.continues && sel0 !== p.selected) later.push({ t: ctx.t0, kind: 'sel', sel: p.selected });
  // At t0 the new query lands before any selection change on the same instant.
  const rank = { query: 0, sel: 1, key: 2 };
  for (const e of later.sort((a, b) => a.t - b.t || rank[a.kind] - rank[b.kind])) {
    const last = out.at(-1);
    out.push({ t: e.t, n: e.kind === 'query' ? n0 : last.n + (e.kind === 'key' ? 1 : 0), q: e.kind === 'query' ? undefined : last.q,
      sel: e.kind === 'sel' ? e.sel : last.sel });
  }
  return out;
}

// For an event: which items are visible, and which item is selected (the sel-th visible one).
function state(p, e) {
  const q = e.q ?? p.query.slice(0, e.n), vis = shown(p).map((it) => matches(it, q));
  const order = vis.flatMap((v, i) => (v ? [i] : []));
  return { vis, selItem: order[e.sel] ?? -1 };
}

// Whether this row shows a caret that is still blinking when it ends: it typed something, or it continued a
// row whose caret was blinking and kept the same query.
const typing = (p, ctx) => p.typeAt >= 0 && p.query.length > kept(p, ctx);
const blinks = (p, ctx) => typing(p, ctx) || (ctx.continues && !!ctx.prev._caret && p.query === ctx.prev.query);

// The row as it stands after its presses: a following command row continues from here (`_caret`: the caret is
// blinking at the end, so a continuation with the same query keeps it).
export const endState = (p, ctx) => ({ ...p, selected: events(p, ctx).at(-1).sel, _caret: blinks(p, ctx) });

const snap = (k) => (k > 0.999 ? 1 : k < 0.001 ? 0 : k);
const soft = (k) => `color-mix(in srgb, var(--accent) ${(14 * k).toFixed(2)}%, transparent)`;

export function render(root, p, ctx, t) {
  const f = root.firstChild, bs = ctx.beat_sec, { Springs } = ctx;
  const tm = times(p, ctx), n = tm.filter((x) => x <= t).length, first = tm[0] ?? Infinity, end = tm.at(-1) ?? Infinity;
  f.querySelector('.cm-text').textContent = p.query.slice(0, n);
  f.querySelector('.cm-ph').style.opacity = n > 0 ? '0' : '1';
  // Caret as in input: solid while typing, then a ~1 Hz blink with a loop-fitted period and the loop's phase.
  // A continuation with the same query keeps a blinking caret blinking (same loop phase, so no jump at t0).
  const blink = loopPeriod(ctx, 1.0), phase = (((t / blink) % 1) + 1) % 1;
  const on = typing(p, ctx) ? t >= first && (t < end || phase < 0.5) : blinks(p, ctx) && phase < 0.5;
  f.querySelector('.cm-caret').style.opacity = on ? '1' : '0';
  const ev = events(p, ctx), st = ev.map((e) => state(p, e));
  const omega = Springs.fromSettle(0.3 * bs, 1), hi = Springs.fromSettle(0.25 * bs, 1);
  const trackOf = (get, w) => snap(Math.max(0, Math.min(1, Springs.track(t, { from: get(st[0]), changes: ev.slice(1).map((e, j) => ({ t: e.t, to: get(st[j + 1]) })), omega: w, zeta: 1 }).value)));
  const now = st[ev.filter((e) => e.t <= t).length - 1];
  let y = TOP + 12;
  f.querySelectorAll('.cm-row').forEach((r, i) => {
    const k = trackOf((s) => (s.vis[i] ? 1 : 0), omega), s = trackOf((x) => (x.selItem === i ? 1 : 0), hi);
    Object.assign(r.style, { top: `${y.toFixed(2)}px`, height: `${(ROW * k).toFixed(2)}px`, opacity: String(k), background: s > 0 ? soft(s) : 'transparent' });
    r.classList.toggle('cm-sel', now.selItem === i);
    y += ROW * k;
  });
  // 'No results' fades in as the last matching row closes (y is where the list ends).
  f.querySelector('.cm-empty').style.opacity = String(Math.max(0, 1 - (y - TOP - 12) / (ROW / 2)).toFixed(4));
  if (!ctx.continues) {
    applyFade(f.querySelector('.cm-head'), fade(ctx, t, ctx.t0 + 0.1 * bs));
    f.querySelectorAll('.cm-label').forEach((e, i) => applyFade(e, fade(ctx, t, ctx.t0 + (0.16 + 0.06 * i) * bs)));
  }
}

// Row 0 is shown settled (typed long ago), and no key sounds once the next row has taken over.
export function sfx(p, ctx) {
  if (ctx.settled) return [];
  return keyBeats(p, ctx).filter((b) => ctx.beatT(b) < ctx.t1).map((beat) => ({ beat, file: 'sfx/key.wav', gain: 0.5 }));
}

// row:<i> is the i-th row visible once the whole query is typed, where it sits then.
export function hotspot(name, p, geo) {
  if (name === 'field') return { x: PAD + 52 + 80 - W / 2, y: TOP / 2 - geo.h / 2 };
  if (!name.startsWith('row:')) return null;
  const i = Number(name.slice(4)), vis = shown(p).filter((it) => matches(it, p.query));
  if (!Number.isInteger(i) || i < 0 || i >= vis.length) return null;
  return { x: 12 + 24 + 90 - W / 2, y: TOP + 12 + i * ROW + ROW / 2 - geo.h / 2 };
}
