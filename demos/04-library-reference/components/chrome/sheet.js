// sheet.js -- a confirmation sheet: a grabber, a title, a short body and action buttons at the bottom right.
import { el, textW, frame, fade, applyFade, pressesOn, pressDepth } from '../core/helpers.js';

export const meta = {
  name: 'sheet', group: 'chrome',
  useWhen: 'The app asks before doing something: delete, discard, sign out, confirm a payment.',
  motion: 'The title, body and actions rise in one after another once the shape arrives. A press on an action dips it. A following sheet row crossfades changed content the same way.',
  props: { title: ['string', 'Delete goal?'], body: ['string', 'This removes Holiday fund and its history.'], actions: ['string[]', ['Cancel', 'Delete']], primary: ['string', 'Delete'] },
  hotspots: ['action:<label>'],
  hotspotExample: { 'action:<label>': 'action:Delete' },
  sounds: [],
  example: "{ at: 0, use: 'sheet', title: 'Delete goal?', body: 'This removes Holiday fund and its history.' }",
  edgeCases: [{ actions: ['OK'], primary: 'OK', body: '' }, { body: 'Your statement for March is ready. It includes every payment in and out, your savings round-ups and the interest earned on each pot.' },
    { title: 'Sign out?', actions: ['Stay', 'Sign out'], primary: 'Nothing' }],
};

// The body spans the sheet and wraps at about 60 characters (28px text averages ~12.5px a character); the height
// estimate uses CPL = 56 so it never runs short.
const W = 900, PAD = 56, BTN_H = 72, GAP = 16, CPL = 56, LINE = 40;
const lines = (p) => (p.body ? Math.ceil(p.body.length / CPL) : 0);
const btnW = (a) => textW(a, 28) + 72;
// Left edge of each action (actions sit right-aligned in a row, the last at the right padding).
function lefts(p) {
  let x = W - PAD - p.actions.reduce((a, b) => a + btnW(b), 0) - GAP * Math.max(0, p.actions.length - 1);
  return p.actions.map((a) => { const l = x; x += btnW(a) + GAP; return l; });
}

export function geometry(p) {
  return { w: W, h: 200 + lines(p) * LINE + 120, r: 40, fill: 'surface', ink: 'ink' };
}

// One set of content: title, body and actions for those props, in a full-size frame.
function content(root, p, cls, h) {
  const f = frame(root, `sh-body ${cls}`, W, h);
  Object.assign(el(f, 'div', { class: 'sh-title' }, p.title).style, { position: 'absolute', left: `${PAD}px`, right: `${PAD}px`, top: '64px', font: '500 34px var(--font)',
    lineHeight: '44px', letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
  Object.assign(el(f, 'div', { class: 'sh-text' }, p.body).style, { position: 'absolute', left: `${PAD}px`, top: '132px', width: `${W - 2 * PAD}px`,
    font: '400 28px var(--font)', lineHeight: `${LINE}px`, color: 'var(--muted)', whiteSpace: 'normal' });
  const acts = el(f, 'div', { class: 'sh-actions' });
  Object.assign(acts.style, { position: 'absolute', inset: '0' });
  const xs = lefts(p);
  p.actions.forEach((a, i) => {
    const on = a === p.primary;
    const b = el(acts, 'div', { class: 'sh-action', 'data-label': a }, a);
    Object.assign(b.style, { position: 'absolute', left: `${xs[i]}px`, top: `${h - 48 - BTN_H}px`, width: `${btnW(a)}px`, height: `${BTN_H}px`, borderRadius: `${BTN_H / 2}px`,
      boxSizing: 'border-box', textAlign: 'center', font: '500 28px var(--font)', lineHeight: `${BTN_H - 4}px`, whiteSpace: 'nowrap',
      background: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--surface)' : 'var(--ink)',
      border: `2px solid ${on ? 'var(--accent)' : 'color-mix(in srgb, var(--muted) 45%, transparent)'}` });
  });
}
const changed = (a, b) => a.title !== b.title || a.body !== b.body || a.primary !== b.primary || a.actions.join('\n') !== b.actions.join('\n');

export function mount(root, p, ctx) {
  Object.assign(el(frame(root, 'sh-grab', 56, ctx.geo.h), 'div').style, { position: 'absolute', left: '0', top: '20px', width: '56px', height: '6px', borderRadius: '3px',
    background: 'color-mix(in srgb, var(--muted) 40%, transparent)' });
  if (ctx.continues && changed(ctx.prev, p)) content(root, ctx.prev, 'sh-prev', ctx.geo.h);
  content(root, p, 'sh-cur', ctx.geo.h);
}

export function render(root, p, ctx, t) {
  const bs = ctx.beat_sec, prev = root.querySelector('.sh-prev'), cur = root.querySelector('.sh-cur');
  if (prev) {
    applyFade(prev, fade(ctx, t, -Infinity, ctx.t0));
    applyFade(cur, fade(ctx, t, ctx.t0 + 0.05 * bs));
  } else if (!ctx.continues) {
    ['.sh-title', '.sh-text', '.sh-actions'].forEach((s, i) => applyFade(cur.querySelector(s), fade(ctx, t, ctx.t0 + (0.12 + 0.08 * i) * bs)));
  }
  for (const b of cur.querySelectorAll('.sh-action')) {
    const pr = pressesOn(ctx, `action:${b.dataset.label}`);
    b.style.transform = `scale(${1 - 0.04 * pressDepth(ctx, t, pr)})`;
  }
}

export function hotspot(name, p, geo) {
  if (!name.startsWith('action:')) return null;
  const i = p.actions.indexOf(name.slice(7));
  if (i < 0) return null;
  return { x: lefts(p)[i] + btnW(p.actions[i]) / 2 - W / 2, y: geo.h / 2 - 48 - BTN_H / 2 };
}
