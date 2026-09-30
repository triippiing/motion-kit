// calendar.js -- one week, Monday to Sunday, with real dates, event chips and a selectable day.
import { el, frame, fade, applyFade, pressesOn } from '../core/helpers.js';

export const meta = {
  name: 'calendar', group: 'data',
  useWhen: 'Something lands on a day: payday, a bill due, a booking.',
  motion: 'The days rise in left to right, then the event chips. `week` is any ISO date (YYYY-MM-DD); the week shown is the Monday-to-Sunday week containing it, with real weekdays and dates. `selected` (1 = Monday ... 7 = Sunday) or a press on `day:<n>` gives that day an accent border; a following calendar row continues from the pressed day (write it as its `selected`). A following row in the same week keeps the days, fades changed chips out and in, and moves the selection; a different week crossfades the days.',
  props: { week: ['string', '2026-03-23'], marks: ['object[]', [{ day: 3, label: 'Payday' }, { day: 5, label: 'Rent £850' }]], selected: ['number', -1], title: ['string', 'March'] },
  hotspots: ['day:<n>'],
  hotspotExample: { 'day:<n>': 'day:3' },
  sounds: [],
  example: "{ at: 0, use: 'calendar', week: '2026-03-23', title: 'March', selected: 5 }",
  edgeCases: [{ week: '2026-03-26' }, { marks: [], selected: 7 },
    { marks: [{ day: 1, label: 'Council tax due' }, { day: 1, label: 'Gym' }, { day: 7, label: 'Birthday dinner at eight' }] },
    { week: '2026-12-31', title: 'December', marks: [{ day: 5, label: 'New Year' }] }],
};

const W = 1000, H = 320, PX = 32, GAP = 12, CT = 96, CH = 196;
const CW = (W - 2 * PX - 6 * GAP) / 7;
const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY = 864e5;
const cellX = (i) => PX + i * (CW + GAP);

export function geometry() {
  return { w: W, h: H, r: 32, fill: 'surface', ink: 'ink' };
}

// The seven dates (UTC) of the Monday-started week containing `week`.
function days(week) {
  const d = new Date(`${week}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || Number.isNaN(d.getTime())) throw new Error(`calendar: week "${week}" is not an ISO date (YYYY-MM-DD)`);
  const monday = d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY;
  return NAMES.map((wd, i) => ({ wd, date: new Date(monday + i * DAY).getUTCDate(), monday }));
}
// One chip per day with marks (several marks on a day share it).
const chips = (p) => [1, 2, 3, 4, 5, 6, 7].map((n) => p.marks.filter((m) => m.day === n).map((m) => String(m.label ?? '')).join(' · '));
const sameWeek = (p, ctx) => ctx.continues && days(ctx.prev.week)[0].monday === days(p.week)[0].monday;

function title(f, p, cls) {
  const l = el(f, 'div', { class: `cl-title ${cls}` }, p.title);
  Object.assign(l.style, { position: 'absolute', left: `${PX + 4}px`, top: '30px', maxWidth: `${W - 2 * PX}px`, font: '500 34px var(--font)', lineHeight: '44px',
    letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis' });
}

function cells(f, p, cls) {
  days(p.week).forEach((d, i) => {
    const c = el(f, 'div', { class: cls, 'data-n': String(i + 1) });
    Object.assign(c.style, { position: 'absolute', left: `${cellX(i)}px`, top: `${CT}px`, width: `${CW}px`, height: `${CH}px`, boxSizing: 'border-box',
      borderRadius: '20px', border: '2px solid transparent', background: 'color-mix(in srgb, var(--muted) 10%, transparent)' });
    Object.assign(el(c, 'div', { class: 'cl-wd' }, d.wd).style, { position: 'absolute', left: '16px', top: '16px', font: '500 18px var(--font)', lineHeight: '24px',
      textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)' });
    Object.assign(el(c, 'div', { class: 'cl-date' }, String(d.date)).style, { position: 'absolute', left: '16px', top: '42px', font: '500 34px var(--font)', lineHeight: '44px',
      fontVariantNumeric: 'tabular-nums' });
  });
}

function chip(f, text, i, cls) {
  const e = el(f, 'div', { class: cls, 'data-n': String(i + 1) }, text);
  Object.assign(e.style, { position: 'absolute', left: `${cellX(i) + 8}px`, width: `${CW - 16}px`, bottom: `${H - CT - CH + 8}px`,
    boxSizing: 'border-box', padding: '6px 10px', borderRadius: '12px', background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
    font: '500 18px var(--font)', lineHeight: '22px', whiteSpace: 'normal', overflowWrap: 'anywhere', overflow: 'hidden', display: '-webkit-box', webkitBoxOrient: 'vertical', webkitLineClamp: '2' });
}

export function mount(root, p, ctx) {
  const f = frame(root, 'cl', W, H);
  if (ctx.continues && ctx.prev.title !== p.title) title(f, ctx.prev, 'cl-prev');
  title(f, p, 'cl-cur');
  const keep = sameWeek(p, ctx);
  if (ctx.continues && !keep) cells(f, ctx.prev, 'cl-old');
  cells(f, p, 'cl-day');
  const was = ctx.continues ? chips(ctx.prev) : [];
  if (ctx.continues) was.forEach((s, i) => { if (s && !(keep && s === chips(p)[i])) chip(f, s, i, 'cl-chip-old'); });
  chips(p).forEach((s, i) => { if (s) chip(f, s, i, 'cl-chip'); });
}

// The selected day over time: where the previous row left it (continuing) or the row's own, the row's own
// on arrival, then each press on a day.
function choices(p, ctx) {
  const list = [{ t: -Infinity, n: ctx.continues ? ctx.prev.selected : p.selected }];
  const later = pressesOn(ctx, 'day').filter((x) => x.kind !== 'up').map((x) => ({ t: x.t, n: Number(x.hotspot.slice(4)) }));
  if (list[0].n !== p.selected) later.push({ t: ctx.t0, n: p.selected });
  return [...list, ...later.sort((a, b) => a.t - b.t)];
}

// The row as it stands after its presses: a following calendar row continues from here.
export const endState = (p, ctx) => ({ ...p, selected: choices(p, ctx).at(-1).n });

export function render(root, p, ctx, t) {
  const f = root.firstChild, bs = ctx.beat_sec, keep = sameWeek(p, ctx);
  const pe = f.querySelector('.cl-prev');
  if (pe) {
    applyFade(pe, fade(ctx, t, -Infinity, ctx.t0));
    applyFade(f.querySelector('.cl-cur'), fade(ctx, t, ctx.t0 + 0.05 * bs));
  } else if (!ctx.continues) applyFade(f.querySelector('.cl-cur'), fade(ctx, t, ctx.t0 + 0.05 * bs));
  for (const e of f.querySelectorAll('.cl-old, .cl-chip-old')) applyFade(e, fade(ctx, t, -Infinity, ctx.t0));
  const list = choices(p, ctx);
  const now = list.filter((c) => c.t <= t).at(-1).n;
  f.querySelectorAll('.cl-day').forEach((e, i) => {
    applyFade(e, fade(ctx, t, keep ? -Infinity : ctx.t0 + (0.1 + 0.04 * i) * bs));
    const n = i + 1;
    const k = Math.max(0, Math.min(1, ctx.Springs.track(t, { from: list[0].n === n ? 1 : 0, changes: list.slice(1).map((c) => ({ t: c.t, to: c.n === n ? 1 : 0 })),
      omega: ctx.Springs.fromSettle(0.25 * bs, 1), zeta: 1 }).value));
    e.classList.toggle('cl-sel', now === n);
    e.style.borderColor = k > 0.999 ? 'var(--accent)' : k < 0.001 ? 'transparent' : `color-mix(in srgb, var(--accent) ${(k * 100).toFixed(1)}%, transparent)`;
  });
  const was = ctx.continues ? chips(ctx.prev) : [];
  for (const e of f.querySelectorAll('.cl-chip')) {
    const i = Number(e.dataset.n) - 1;
    const kept = keep && was[i] === e.textContent;
    applyFade(e, fade(ctx, t, kept ? -Infinity : ctx.t0 + ((ctx.continues ? 0.25 : 0.5) + 0.04 * i) * bs));
  }
}

export function hotspot(name) {
  if (!name.startsWith('day:')) return null;
  const n = Number(name.slice(4));
  if (!Number.isInteger(n) || n < 1 || n > 7) return null;
  return { x: cellX(n - 1) + CW / 2 - W / 2, y: CT + CH / 2 - H / 2 };
}
