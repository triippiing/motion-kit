// input.js -- a text field that types its text a character at a time, with a caret and a clear button.
import { el, textW, frame, icon, prog, fade, applyFade, pressesOn } from '../core/helpers.js';

export const meta = {
  name: 'input', group: 'controls',
  useWhen: 'Something is typed: a search, an amount, a name.',
  motion: "Text types in one character every perChar beats from typeAt (beats after the row starts; -1 shows it at once), with a key sound each, a solid caret while typing and a 1 Hz blink after. The clear button appears with the first character; a press on it dissolves the text back to the placeholder. A continuation whose text extends the previous row's keeps typing on; other text changes dissolve the old text.",
  props: { placeholder: ['string', 'Search'], text: ['string', ''], typeAt: ['number', -1], perChar: ['number', 0.25], icon: ['enum:search|none', 'search'] },
  hotspots: ['field', 'clear'],
  sounds: ['key'],
  example: "{ at: 0, use: 'input', placeholder: 'Search transactions', text: 'Groceries', typeAt: 0.25 }",
  edgeCases: [{ text: '' }, { icon: 'none', text: 'Council tax', typeAt: -1 }, { text: 'A very long search query that keeps on going until the field is full', typeAt: -1 }],
};

const CLEAR = 40;
const fieldX = (p) => (p.icon === 'none' ? 40 : 92);

export function geometry(p) {
  const longer = p.text.length > p.placeholder.length ? p.text : p.placeholder;
  return { w: Math.min(1100, Math.max(560, 140 + textW(longer, 30) + 80)), h: 112, r: 28, fill: 'surface', ink: 'ink' };
}

export function mount(root, p, ctx) {
  const { w, h } = ctx.geo;
  const f = frame(root, 'in', w, h);
  if (p.icon !== 'none') Object.assign(icon(f, p.icon, 32).style, { position: 'absolute', left: '40px', top: `${(h - 32) / 2}px`, color: 'var(--muted)' });
  const field = el(f, 'div', { class: 'in-field' });
  Object.assign(field.style, { position: 'absolute', left: `${fieldX(p)}px`, width: `${w - fieldX(p) - CLEAR - 56}px`, top: '0', height: `${h}px`,
    display: 'grid', alignItems: 'center', font: '400 28px var(--font)', overflow: 'hidden' });
  const cell = { gridArea: '1 / 1', display: 'flex', alignItems: 'center' };
  Object.assign(el(field, 'span', { class: 'in-ph' }, p.placeholder).style, cell, { color: 'var(--muted)' });
  if (ctx.continues && ctx.prev.text && !kept(p, ctx)) Object.assign(el(field, 'span', { class: 'in-prev' }, ctx.prev.text).style, cell);
  const typed = el(field, 'span', { class: 'in-typed' });
  Object.assign(typed.style, cell);
  el(typed, 'span', { class: 'in-text' });
  Object.assign(el(typed, 'span', { class: 'in-caret' }).style, { width: '2px', height: '34px', marginLeft: '2px', background: 'var(--accent)' });
  const clear = el(f, 'div', { class: 'in-clear' });
  Object.assign(clear.style, { position: 'absolute', left: `${w - 36 - CLEAR}px`, top: `${(h - CLEAR) / 2}px`, width: `${CLEAR}px`, height: `${CLEAR}px`,
    borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--muted) 22%, transparent)' });
  icon(clear, 'x', 22);
}

// Characters carried over from the previous row (its text is a prefix of this one).
const kept = (p, ctx) => (ctx.continues && p.text.startsWith(ctx.prev.text) ? ctx.prev.text.length : 0);
// Row 0 is shown settled: its clock started long before its beat, so its typing is long done.
const settled = (ctx) => ctx.t0 !== ctx.beatT(ctx.row.at);
// The beat each newly typed character lands on (none when the text is shown at once).
const keyBeats = (p, ctx) => (p.typeAt < 0 ? [] : [...p.text.slice(kept(p, ctx))].map((_, j) => ctx.row.at + p.typeAt + j * p.perChar));

export function render(root, p, ctx, t) {
  const f = root.firstChild, bs = ctx.beat_sec, keep = kept(p, ctx);
  const times = [...Array(keep).fill(-Infinity), ...keyBeats(p, ctx).map((b) => ctx.t0 + ctx.beatT(b) - ctx.beatT(ctx.row.at))];
  if (p.typeAt < 0) times.push(...Array(p.text.length - keep).fill(-Infinity));
  const n = times.filter((x) => x <= t).length, first = times[0] ?? Infinity, end = times.at(-1) ?? Infinity;
  const tClear = n ? pressesOn(ctx, 'clear').filter((x) => x.kind !== 'up' && x.t >= first).map((x) => x.t).sort((a, b) => a - b)[0] ?? Infinity : Infinity;
  const cleared = t >= tClear;
  f.querySelector('.in-text').textContent = p.text.slice(0, n);
  f.querySelector('.in-typed').style.opacity = String(cleared ? 1 - prog(ctx, t, tClear, 0.3) : 1);
  // The caret only exists while there is typing to show: solid while typing, then a 1 Hz blink.
  const typing = p.typeAt >= 0 && p.text.length > keep;
  const caretOn = typing && !cleared && t >= first && (t < end || Math.floor((t - end) / 0.5) % 2 === 0);
  f.querySelector('.in-caret').style.opacity = caretOn ? '1' : '0';
  const prevEl = f.querySelector('.in-prev');
  if (prevEl) applyFade(prevEl, fade(ctx, t, -Infinity, ctx.t0));
  const ph = f.querySelector('.in-ph');
  ph.style.opacity = String(cleared ? prog(ctx, t, tClear + 0.1 * bs, 0.4) : n > 0 ? 0 : prevEl ? prog(ctx, t, ctx.t0 + 0.1 * bs, 0.4) : 1);
  // The clear button: in with the first character, out on clear; a continuation from text fades the old one.
  const was = ctx.continues && ctx.prev.text && !keep ? 1 - prog(ctx, t, ctx.t0, 0.2) : 0;
  const cl = n > 0 ? prog(ctx, t, first, 0.3) * (cleared ? 1 - prog(ctx, t, tClear, 0.2) : 1) : 0;
  const c = Math.max(was, cl);
  Object.assign(f.querySelector('.in-clear').style, { opacity: String(c), transform: `scale(${0.7 + 0.3 * c})` });
}

export function sfx(p, ctx) {
  if (settled(ctx)) return [];
  return keyBeats(p, ctx).map((beat) => ({ beat, file: 'sfx/key.wav', gain: 0.5 }));
}

export function hotspot(name, p, geo) {
  if (name === 'field') return { x: fieldX(p) + 80 - geo.w / 2, y: 0 };
  if (name === 'clear') return { x: geo.w / 2 - 36 - CLEAR / 2, y: 0 };
  return null;
}
