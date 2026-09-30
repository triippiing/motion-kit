// helpers.js -- pure building blocks shared by components. Nothing here reads a clock.
export { RESERVED } from './validate.js';
const SVG = 'http://www.w3.org/2000/svg';

export function el(parent, tag, attrs = {}, text) {
  const e = tag.startsWith('svg:') ? document.createElementNS(SVG, tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  parent.appendChild(e);
  return e;
}

// A fixed design-size box in a component's layer, centred (or pinned to the top), so the content keeps
// its layout while the shape morphs around it (the shape clips whatever is outside).
export function frame(layer, cls, w, h, top = false) {
  const f = el(layer, 'div', { class: cls });
  Object.assign(f.style, { position: 'absolute', left: `calc(50% - ${w / 2}px)`, top: top ? '0px' : `calc(50% - ${h / 2}px)`, width: `${w}px`, height: `${h}px` });
  return f;
}

// Deterministic text width estimate (no layout at geometry time): ~0.56em per character.
export const textW = (text, size, weight = 500) => String(text).length * size * (weight >= 600 ? 0.6 : 0.56);

// 0 -> 1 progress of a critically damped (default) spring released at t0.
export function prog(ctx, t, t0, settleBeats = 0.6, zeta = 1) {
  if (t < t0) return 0;
  if (t0 === -Infinity) return 1; // released forever ago (the spring maths would give NaN)
  const omega = ctx.Springs.fromSettle(settleBeats * ctx.beat_sec, zeta);
  return ctx.Springs.spring(t, { from: 0, to: 1, t0, omega, zeta }).value;
}

// Progress for a counted number (0..1 from a no-overshoot prog): the spring's last 2% (its settle tolerance)
// is folded in, so the count lands exactly on its final value at the settle time instead of creeping on.
export const landed = (k) => Math.min(1, k / 0.98);

// Sub-element enter/exit inside a row: rises 12px and unblurs after tIn, leaves fast at tOut.
export function fade(ctx, t, tIn, tOut = Infinity) {
  const i = prog(ctx, t, tIn, 0.5), o = t >= tOut ? 1 - prog(ctx, t, tOut, 0.2) : 1;
  const a = Math.max(0, Math.min(1, i * o));
  return { o: a, y: (1 - i) * 12, blur: (1 - a) * 6 };
}
export const applyFade = (e, f) => Object.assign(e.style, { opacity: f.o, transform: `translateY(${f.y}px)`, filter: f.blur > 0.05 ? `blur(${f.blur}px)` : 'none' });

// The period to use for periodic motion (spin, pulse, blink) near `sec` seconds: in a loop, the nearest
// period that fits a whole number of times into ctx.loop_sec, so the motion matches across the seam.
// ANY periodic motion in a component must take its period from here.
export const loopPeriod = (ctx, sec) => (ctx.loop_sec ? ctx.loop_sec / Math.max(1, Math.round(ctx.loop_sec / sec)) : sec);

export const drawOn = (ctx, t, t0, beats = 0.8) => Math.max(0, Math.min(1, prog(ctx, t, t0, beats)));

// A series linearly resampled to n values over the same span, so a line can morph point for point into
// one with a different point count.
export function resample(v, n) {
  if (!v.length || n <= 0) return [];
  if (v.length === 1 || n === 1) return Array(n).fill(v.at(-1));
  return Array.from({ length: n }, (_, j) => {
    const x = (j / (n - 1)) * (v.length - 1), i = Math.min(v.length - 2, Math.floor(x)), f = x - i;
    return v[i] + (v[i + 1] - v[i]) * f;
  });
}

// Pixel points of a series in a w x h box: first to last across, the range lo..hi from the bottom to the top
// (a flat series, or a single point, sits at mid height; a single point also at mid width).
export function plotLine(v, w, h, lo = Math.min(...v), hi = Math.max(...v)) {
  const n = v.length;
  return v.map((y, i) => ({ x: n > 1 ? (i / (n - 1)) * w : w / 2, y: hi > lo ? h - ((y - lo) / (hi - lo)) * h : h / 2 }));
}

// A continuing line at k (0..1): the previous series, resampled to this one's count and plotted on its own
// scale, moving point for point onto this series on its scale.
export function morphLine(from, to, w, h, k) {
  const b = plotLine(to, w, h);
  if (!from.length || !to.length || k >= 1) return b;
  const a = plotLine(resample(from, to.length), w, h, Math.min(...from), Math.max(...from));
  return b.map((q, i) => ({ x: a[i].x + (q.x - a[i].x) * k, y: a[i].y + (q.y - a[i].y) * k }));
}
export const pathD = (pts) => pts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(2)} ${q.y.toFixed(2)}`).join(' ');

// The sign comes from the rounded value, so -0.4 shows as 0, not -0.
export function fmt(n, { decimals = 0, prefix = '', suffix = '' } = {}) {
  const k = 10 ** decimals, r = Math.round(Math.abs(n) * k) / k;
  const s = r.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${n < 0 && r > 0 ? '-' : ''}${prefix}${s}${suffix}`;
}

// A theme role if the theme defines it as a colour, else the fallback role.
export const role = (ctx, name, fallback) => (/^#[0-9a-f]{6}$/i.test(ctx.theme[name] ?? '') ? name : fallback);
export const cssRole = (ctx, name, fallback) => `var(--${role(ctx, name, fallback)})`;

// One stroke weight everywhere: 24-unit grid, stroke 2, round caps and joins.
export const ICONS = {
  check: 'M5 12.5l4.5 4.5L19 7.5', x: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14',
  chevron: 'M9 6l6 6-6 6', 'chevron-down': 'M6 9l6 6 6-6', play: 'M8 5.5v13l10-6.5z', pause: 'M8.5 5v14M15.5 5v14',
  upload: 'M12 16V5M7 10l5-5 5 5M5 19h14', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM16.5 16.5L20 20',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4', info: 'M12 11v6M12 7.5v.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z', calendar: 'M5 6h14v14H5zM5 10h14M9 4v4M15 4v4', trend: 'M4 17l5-5 4 4 7-8M15 8h5v5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4',
  music: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z', volume: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  command: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z', wallet: 'M4 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4zM4 7V5h12M16 13h.01',
};
export function icon(parent, name, size = 32) {
  if (!Object.hasOwn(ICONS, name)) throw new Error(`unknown icon "${name}" (icons: ${Object.keys(ICONS).join(', ')})`);
  const s = el(parent, 'svg:svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: `ico ico-${name}` });
  el(s, 'svg:path', { d: ICONS[name] });
  return s;
}

// Presses aimed at a hotspot (`button`) or any of a parametrised family (`tab` -> `tab:Month`).
export const pressesOn = (ctx, prefix) => ctx.presses.filter((p) => p.hotspot && (p.hotspot === prefix || p.hotspot.startsWith(prefix + ':')));

// How far a pressed control is pushed in, 0..1, following the cursor's press kinds:
// true dips just before the beat and recovers just after; 'down' dips and holds; 'up' recovers.
// Same timing as the engine's cursor press, so the control and the pointer move together.
export function pressDepth(ctx, t, presses = ctx.presses) {
  const bs = ctx.beat_sec, down = (p) => ({ t: p.t - 0.08 * bs, to: 1 });
  const changes = presses.flatMap((p) => (p.kind === 'down' ? [down(p)] : p.kind === 'up' ? [{ t: p.t, to: 0 }] : [down(p), { t: p.t + 0.1 * bs, to: 0 }]));
  if (!changes.length) return 0;
  return ctx.Springs.track(t, { from: 0, changes, omega: ctx.Springs.fromSettle(0.15 * bs, 1), zeta: 1 }).value;
}

// Two-edge travelling indicator (reversal-safe): same maths as motion-ui pattern 2.
// from: starting slot; changes: [{ t, index }] (t in seconds); settle: trailing edge's settle time
// in SECONDS (pass k * ctx.beat_sec); n: slot count; lead: the leading edge settles in settle * lead.
// Returns the indicator's edges in slot units, clamped to 0..n.
export function edges(ctx, from, changes, t, settle, n, lead = 0.7) {
  const { Springs } = ctx;
  const trail = Springs.fromSettle(settle, 1), fast = Springs.fromSettle(settle * lead, 1);
  const hold = (x, a, b) => Math.min(Math.max(x, Math.min(a, b)), Math.max(a, b));
  const e = [{ x: from, v: 0, x0: from, to: from, t: -Infinity, w: trail }, { x: from + 1, v: 0, x0: from + 1, to: from + 1, t: -Infinity, w: trail }];
  const at = (s, tt) => { if (!Number.isFinite(s.t) || tt < s.t) return { x: s.x0, v: 0 }; const r = Springs.response(tt - s.t, s.x0 - s.to, s.v0 ?? 0, s.w, 1); const x = hold(s.to + r.e, s.x0, s.to); return { x, v: x === s.to + r.e ? r.v : 0 }; };
  for (const c of changes.filter((c) => c.t <= t).sort((a, b) => a.t - b.t)) {
    const now = e.map((s) => at(s, c.t));
    const fwd = c.index + 0.5 > (now[0].x + now[1].x) / 2;
    e[0] = { x0: now[0].x, v0: now[0].v, to: c.index, t: c.t, w: fwd ? trail : fast };
    e[1] = { x0: now[1].x, v0: now[1].v, to: c.index + 1, t: c.t, w: fwd ? fast : trail };
  }
  const l = at(e[0], t).x, r = at(e[1], t).x;
  return { left: Math.max(0, Math.min(n, l)), right: Math.max(0, Math.min(n, r)) };
}
