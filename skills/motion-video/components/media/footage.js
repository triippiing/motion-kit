// footage.js -- a clip (footage/<src>/: frame-00001.jpg ... and clip.json, made by footage.mjs or capture.mjs) playing
// inside the shape, frame-exact. Clip time is from + (t - t0) x speed, clamped to the clip (it holds the last frame) and
// frozen outside the row's window; frame n = round(clipT x fps) + 1: a pure function of t. render shows frame n and
// registers its decode with ctx.wait, so seek(t) resolves once the frame is on screen; callers that do not await
// (watch, sync, ?play) show it as soon as it decodes. A decode that fails keeps the last good frame and is raised with
// reportError (a page error: render.mjs exits 1 on it), while ctx.wait still sees its promise resolve.
// The page fetches each used clip's clip.json before ready (ctx.clips[src]); validation receives the same as data.
// A row must set src itself (meta's 'demo' default is for the catalog only), to a folder inside footage/ (safeSrc).
// zoom/focus: the clip scaled by zoom with focus (fractions of the frame) at the shape's centre, clamped so no empty
// edge shows; a continuation of the same src glides there from the previous row's framing. browser: a drawn window
// (title bar with three dots and the URL) around the clip, part of the zoomed content. A row with neither (and not
// gliding from one that had them) builds exactly the DOM it always did.
import { prog, textW } from '../core/helpers.js';

export const meta = {
  name: 'footage', group: 'media',
  useWhen: 'Real app footage: a capture (capture.mjs) or a screen recording (footage.mjs) playing in the shape, the cursor aimed at the steps the capture clicked.',
  motion: 'The clip plays from `from` seconds in at `speed` and holds its last frame when it runs out; the frame is a pure function of t. A following footage row of the same src carries on from where the clip had got to (unless it sets from) while the shape morphs. `zoom` (1 or more) scales the clip about `focus` (fractions of the frame, shown at the shape\'s centre, never past an edge of the clip); a following row of the same src glides from the previous zoom/focus to its own on a spring (0.6 beat, no overshoot), so a close-up pulls back to the whole screen. `browser` (a URL) draws the clip inside a plain window (title bar, three dots, the URL in a rounded field) that is part of the zoomed content: zoom 1 shows the whole window.',
  props: { src: ['string', 'demo'], from: ['number', 0], speed: ['number', 1], fit: ['enum:cover|contain', 'cover'], width: ['number', 0],
    zoom: ['number', 1], focus: ['number[]', [0.5, 0.5]], browser: ['string', ''] },
  hotspots: ['step:<name>', 'point:<x,y>'],
  hotspotExample: { 'step:<name>': 'step:Pay', 'point:<x,y>': 'point:0.5,0.5' },
  sounds: [],
  example: "{ at: 0, use: 'footage', src: 'demo' }",
  edgeCases: [{ src: 'demo', from: 1, speed: 0.5 }, { src: 'demo', fit: 'contain', w: 900, h: 900 }, { src: 'demo', zoom: 3, focus: [0.25, 0.75] },
    { src: 'demo', browser: 'example.com/sync' }, { src: 'demo', browser: 'example.com/sync', zoom: 2.5, focus: [0.5, 0] }],
};

// width 0: fit the clip's aspect inside the stage (in design px) less MARGIN on every side. FALLBACK is the aspect
// used when there is no clip to read (validation without a project); the missing clip is reported by check().
const MARGIN = 0.1, R = 32, CACHE = 8;
const FALLBACK = { width: 1600, height: 900 };

export function geometry(p, ctx = {}) {
  const win = windowSize(ctx.clips?.[p.src] ?? FALLBACK, p.browser), c = { width: win.W, height: win.H };
  const stage = ctx.stage ?? { width: 1440, height: 1440 };
  const K = Math.max(1, Math.min(stage.width, stage.height) / 1440);
  const bw = (stage.width / K) * (1 - 2 * MARGIN), bh = (stage.height / K) * (1 - 2 * MARGIN);
  const w = p.width > 0 ? p.width : Math.min(bw, (bh * c.width) / c.height);
  return { w: Math.round(w), h: Math.round((w * c.height) / c.width), r: R, fill: 'ink', ink: 'surface' };
}

// ---- zoom, focus and the window. Window space is in clip px: the clip is W x H, with the title bar (browser set)
// `bar` px tall above it, so the window is W x (H + bar) and the clip's own y is shifted down by bar.
export const barHeight = (clip, browser) => (browser ? Math.round(Math.max(0.04 * clip.height, clip.width / 32)) : 0);
export function windowSize(clip, browser) {
  const bar = barHeight(clip, browser);
  return { W: clip.width, H: clip.height + bar, bar };
}
const fitScale = (fit, geo, win) => (fit === 'contain' ? Math.min : Math.max)(geo.w / win.W, geo.h / win.H);
// Invalid values (check reports them) fall back to the defaults here, so hotspot and render never throw on them.
const zoomOf = (p) => (typeof p.zoom === 'number' && p.zoom >= 1 && Number.isFinite(p.zoom) ? p.zoom : 1);
const goodFocus = (f) => Array.isArray(f) && f.length === 2 && f.every((x) => typeof x === 'number' && x >= 0 && x <= 1);
const focusOf = (p) => (goodFocus(p.focus) ? p.focus : [0.5, 0.5]);
// Whether a row uses any of it: a row that does not (and does not glide from one that did) is the plain old footage.
const framed = (p) => !!p && (p.zoom !== 1 || !Array.isArray(p.focus) || p.focus[0] !== 0.5 || p.focus[1] !== 0.5 || !!p.browser);
const glidesFrom = (p, ctx) => (ctx?.continues && ctx.prev?.src === p.src && !ctx.prev.browser === !p.browser ? ctx.prev : null);

// A view { zoom, x, y }: (x, y) is the window point at the shape's centre. Clamped so the window covers the shape
// on every axis it can (a letterboxed axis, contain, stays centred), and zoom is never under 1.
export function clampView(v, geo, win, fit) {
  const zoom = Math.max(1, v.zoom), s = fitScale(fit, geo, win) * zoom;
  const c = (x, size, view) => (view >= size ? size / 2 : Math.min(size - view / 2, Math.max(view / 2, x)));
  return { zoom, x: c(v.x, win.W, geo.w / s), y: c(v.y, win.H, geo.h / s) };
}

// The row's own framing once settled: focus (fractions of the clip's frame) at the centre, clamped.
export function settledView(p, geo, clip) {
  const win = windowSize(clip, p.browser), [fx, fy] = focusOf(p);
  return clampView({ zoom: zoomOf(p), x: fx * clip.width, y: win.bar + fy * clip.height }, geo, win, p.fit);
}

// The view at t: a continuation of the same src (and the same browser on/off) glides from where the previous row
// ended (endState's _view) to this row's own on one no-overshoot spring released at t0 (0.6 beat, the house settle):
// zoom geometrically (an even pull-back), the centre linearly, clamped after. Otherwise this row's own view.
const SETTLE = 0.6;
export function viewAt(p, ctx, t) {
  const clip = ctx.clips?.[p.src] ?? FALLBACK, geo = ctx.geo ?? geometry(p, ctx);
  const to = settledView(p, geo, clip), prev = glidesFrom(p, ctx);
  if (!prev || !ctx.Springs || !(t < Infinity)) return to;
  const from = prev._view ?? settledView(prev, geo, clip);
  const k = prog(ctx, t, ctx.t0, SETTLE, 1);
  if (k >= 1) return to;
  const lz = Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * k;
  return clampView({ zoom: Math.exp(lz), x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }, geo, windowSize(clip, p.browser), p.fit);
}

// The window's box in shape px (from the shape's top-left) for view v: what render lays out, for the tests.
export function contentBox(v, geo, win, fit) {
  const scale = fitScale(fit, geo, win) * v.zoom;
  return { left: geo.w / 2 - v.x * scale, top: geo.h / 2 - v.y * scale, width: win.W * scale, height: win.H * scale, scale };
}

// Where the clip starts for this row: a continuation of the same src carries on from the previous row's end
// (endState's _clipEnd) unless the row sets `from` itself.
function startTime(p, ctx) {
  const carry = ctx.continues && ctx.prev?.src === p.src && !Object.hasOwn(ctx.row ?? {}, 'from') && Number.isFinite(ctx.prev?._clipEnd);
  return carry ? ctx.prev._clipEnd : p.from;
}

// Clip seconds at loop time t: from the row's own beat (row 0's ctx.t0 is -1e6), frozen before it and after t1.
export function clipTime(p, ctx, t) {
  const clip = ctx.clips?.[p.src];
  if (!clip) return 0;
  const t0 = ctx.beatT(ctx.row.at), t1 = ctx.t1 ?? Infinity;
  const dt = Math.min(Math.max(t, t0), t1) - t0;
  const x = startTime(p, ctx) + (p.speed === 0 ? 0 : dt * p.speed);
  return Math.min(Math.max(x, 0), clip.duration);
}

// Frame number (1-based) for clip time clipT: never past the last frame.
export const frameIndex = (clip, clipT) => Math.min(clip.frames, Math.max(1, Math.round(clipT * clip.fps) + 1));
// The page's URL of frame n of clip src (its own 5-digit pad: clip.mjs's framePath is Node-only).
export const framePath = (src, n) => `footage/${src.split('/').map(encodeURIComponent).join('/')}/frame-${String(n).padStart(5, '0')}.jpg`;

// _view: the framing the row ends on (a continuation glides from it); validation's partial ctx has no Springs, so
// there it is the settled view.
export function endState(p, ctx) {
  return { ...p, _clipEnd: clipTime(p, ctx, ctx.t1 ?? Infinity), _view: viewAt(p, ctx, ctx.t1 ?? Infinity) };
}

// One <img> per frame, always made the same way, so the layer serialises the same whatever was cached.
function frameImg(fit, src) {
  const img = document.createElement('img');
  for (const [k, v] of [['class', 'ft-frame'], ['alt', ''], ['draggable', 'false']]) img.setAttribute(k, v);
  Object.assign(img.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: fit, display: 'block' });
  if (src) img.setAttribute('src', src);
  return img;
}

const state = new WeakMap();

// The window's parts, in clip px of the window (n * --s is n clip px on screen; see render). Only with browser.
function barParts(win, url) {
  const B = win.bar, font = Math.round(0.5 * B), pad = 0.6 * B, max = 0.5 * win.W - 2 * pad;
  let text = url;   // cut a long URL (by the kit's width estimate) rather than let the field clip it
  while (text.length > 1 && textW(text, font, 400) > max) text = text.slice(0, -2) + '…';
  const field = Math.max(0.3 * win.W, Math.min(0.5 * win.W, textW(text, font, 400) + 2 * pad));
  return { B, font, field, fieldH: 0.7 * B, dot: 0.26 * B, text };
}
const S = (n) => `calc(var(--s) * ${+n.toFixed(4)})`;

export function mount(root, p, ctx) {
  const clip = ctx?.clips?.[p.src];
  if (!clip || !(framed(p) || framed(glidesFrom(p, ctx)))) {
    const img = root.appendChild(frameImg(p.fit));
    state.set(root, { img, want: 0, loading: new Map(), cache: new Map() });
    return;
  }
  // .ft-view is the layer's size and a size container, so the window is laid out against the live shape (cq units)
  // even while it morphs. .ft-win is the window at its zoomed size: no transform scales it, so frames stay sharp.
  const win = windowSize(clip, p.browser), pct = (n) => `${+((n / win.H) * 100).toFixed(4)}%`;
  const view = root.appendChild(document.createElement('div'));
  view.className = 'ft-view';
  Object.assign(view.style, { position: 'absolute', inset: '0', containerType: 'size' });
  const box = view.appendChild(document.createElement('div'));
  box.className = 'ft-win';
  box.style.position = 'absolute';
  const page = box.appendChild(document.createElement('div'));
  page.className = 'ft-page';
  Object.assign(page.style, { position: 'absolute', left: '0', width: '100%', top: pct(win.bar), height: pct(clip.height) });
  const img = page.appendChild(frameImg(p.fit));
  let url = null, parts = null;
  if (win.bar) {
    parts = barParts(win, p.browser);
    const bar = box.appendChild(document.createElement('div'));
    bar.className = 'ft-bar';
    Object.assign(bar.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: pct(win.bar), background: 'var(--surface)' });
    for (let i = 0; i < 3; i++) {
      const d = bar.appendChild(document.createElement('span'));
      d.className = 'ft-dot';
      Object.assign(d.style, { position: 'absolute', top: S((parts.B - parts.dot) / 2), left: S(0.8 * parts.B + i * 1.7 * parts.dot),
        width: S(parts.dot), height: S(parts.dot), borderRadius: '50%', background: 'var(--muted)' });
    }
    const field = bar.appendChild(document.createElement('div'));
    field.className = 'ft-url';
    Object.assign(field.style, { position: 'absolute', left: S((win.W - parts.field) / 2), top: S((parts.B - parts.fieldH) / 2), width: S(parts.field),
      height: S(parts.fieldH), borderRadius: S(parts.fieldH / 2), background: 'color-mix(in srgb, var(--muted) 16%, var(--surface))',
      display: 'grid', placeItems: 'center' });
    url = field.appendChild(document.createElement('span'));
    url.className = 'ft-url-text';
    Object.assign(url.style, { font: `400 ${S(parts.font)} var(--font)`, lineHeight: '1', color: 'var(--ink)', whiteSpace: 'nowrap' });
    url.textContent = parts.text;
  }
  state.set(root, { img, want: 0, loading: new Map(), cache: new Map(), box, url, parts, win, clip });
}

// The window's place for this frame. --s is screen px per window px: the fit scale of the live shape (cq units of
// .ft-view) times zoom. The centre comes from viewAt (clamped against the row's geometry); CSS clamps it again
// against the live shape, so a morph between rows never shows an empty edge either.
function place(st, p, ctx, t) {
  const { box, win, url, parts } = st, v = viewAt(p, ctx, t), f = (n) => +n.toFixed(4);
  const fn = p.fit === 'contain' ? 'min' : 'max';
  const s = `calc(${fn}(100cqw / ${win.W}, 100cqh / ${win.H}) * ${f(v.zoom)})`;
  const axis = (cq, size, at) => {
    const d = `(100${cq} - var(--s) * ${size})`;
    return `clamp(min(${d}, ${d} / 2), 50${cq} - var(--s) * ${f(at)}, max(0px, ${d} / 2))`;
  };
  box.style.setProperty('--s', s);
  Object.assign(box.style, { width: `calc(var(--s) * ${win.W})`, height: `calc(var(--s) * ${win.H})`, left: axis('cqw', win.W, v.x), top: axis('cqh', win.H, v.y) });
  if (url) {
    // The URL is measured by the frame check while its field is in view; zoomed past it, the shape crops it on
    // purpose (like the rest of the page), so it is marked data-overhang.
    const geo = ctx.geo ?? geometry(p, ctx), sc = fitScale(p.fit, geo, win) * v.zoom;
    const hw = geo.w / (2 * sc), hh = geo.h / (2 * sc), x0 = (win.W - parts.field) / 2, y0 = (parts.B - parts.fieldH) / 2;
    const inside = x0 >= v.x - hw - 0.5 && x0 + parts.field <= v.x + hw + 0.5 && y0 >= v.y - hh - 0.5 && y0 + parts.fieldH <= v.y + hh + 0.5;
    if (inside) url.removeAttribute('data-overhang'); else url.setAttribute('data-overhang', '');
  }
}

export function render(root, p, ctx, t) {
  const clip = ctx.clips?.[p.src], st = state.get(root);
  if (!clip || !st) return;
  if (st.box) place(st, p, ctx, t);
  const n = frameIndex(clip, clipTime(p, ctx, t));
  if (n === st.want) {
    // Same frame as the last seek: wait on it again if it is still loading (an earlier seek nobody awaited).
    if (st.loading.has(n)) ctx.wait(st.loading.get(n));
    return;
  }
  st.want = n;
  const show = (img) => { if (st.img !== img) { st.img.parentNode.replaceChild(img, st.img); st.img = img; } };
  const hit = st.cache.get(n);
  if (hit) {
    st.cache.delete(n); st.cache.set(n, hit);   // most recently used last
    show(hit);
    return;
  }
  if (st.loading.has(n)) { ctx.wait(st.loading.get(n)); return; }
  const url = framePath(p.src, n);
  const img = frameImg(p.fit, url);
  const job = img.decode().then(() => {
    st.cache.set(n, img);
    while (st.cache.size > CACHE) st.cache.delete(st.cache.keys().next().value);
    if (st.want === n) show(img);   // a later seek may want another frame by now: then this one is only cached
  }, (e) => {
    // Resolve (ctx.wait never sees a rejection: callers that do not await must not get an unhandled one), but raise
    // it on the page's error path: render.mjs fails on it rather than encode a held frame, and watch shows it.
    const err = new Error(`footage: cannot load ${url} (${e?.message ?? e}); the last good frame stays`);
    if (typeof reportError === 'function') reportError(err); else console.error(err.message);
  }).finally(() => { st.loading.delete(n); });
  st.loading.set(n, job);
  ctx.wait(job);
}

// step:NAME aims at the centre of the box the capture clicked; point:X,Y at fractions of the frame. Clip pixels map
// through fit (cover crops, contain letterboxes), the browser bar and the row's own SETTLED zoom/focus to the shape,
// as offsets from its centre. The engine resolves a cursor row to one fixed point (hotspot has no t), so on a row
// that glides in from another framing, aim and press once the glide has settled (0.6 beat after the row's beat).
// Without the clip (validation asks with ctx = {}) a step resolves at the centre: whether it exists is
// checkTarget's call.
export function hotspot(name, p, geo, ctx) {
  const clip = ctx?.clips?.[p.src], W = clip?.width ?? FALLBACK.width, H = clip?.height ?? FALLBACK.height;
  let x, y;
  if (name.startsWith('step:')) {
    const s = clip?.steps?.find((q) => q.name === name.slice(5));
    if (!s) return { x: 0, y: 0 };
    x = s.box.x + s.box.w / 2; y = s.box.y + s.box.h / 2;
  } else if (name.startsWith('point:')) {
    const m = name.slice(6).split(',').map((v) => (v.trim() === '' ? NaN : Number(v)));
    if (m.length !== 2 || !m.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) return null;
    x = m[0] * W; y = m[1] * H;
  } else return null;
  const c = { width: W, height: H }, win = windowSize(c, p.browser), v = settledView(p, geo, c);
  const k = fitScale(p.fit, geo, win) * v.zoom;
  return { x: (x - v.x) * k, y: (y + win.bar - v.y) * k };
}

// Whether src names a folder inside footage/: not absolute (/x, \\x, C:x) and no ".." segment (/ or \\ separated).
// tables.mjs (the Node side) applies the same test before it reads a clip.
export const safeSrc = (src) => typeof src === 'string' && !/^([\\/]|[A-Za-z]:)/.test(src) && !src.split(/[\\/]/).includes('..');

// Validation (validate.js), with the clips as data: info = { clips, strict, at (the row's beat, for messages), row,
// beatT (null: no timing, so no hold check), t1 (seconds; Infinity when unknown), continues, prev, seam (the last row
// of a looping piece) }. A row without its own src, or an unsafe one, is an error even then; otherwise no clips
// (undefined): nothing to check against.
export function check(p, info) {
  const errors = [], warnings = [];
  // src must be the row's own (meta's 'demo' default is only for the catalog), and a folder inside footage/.
  const own = info.row && typeof info.row === 'object' ? info.row.src : p.src;
  if (typeof own !== 'string' || !own) return { errors: ['footage needs src'], warnings };
  if (!safeSrc(own)) return { errors: [`footage: src ${JSON.stringify(own)} must be a folder inside footage/ (no ".." segments, not an absolute path)`], warnings };
  // zoom and focus need no clip: checked with or without one (their types are validate's).
  if (typeof p.zoom === 'number' && !(p.zoom >= 1)) errors.push(`footage: zoom must be 1 or more (1 shows the whole frame), got ${p.zoom}`);
  if (Array.isArray(p.focus) && p.focus.every((x) => typeof x === 'number') && !goodFocus(p.focus))
    errors.push(`footage: focus must be [x, y], two fractions of the frame from 0 to 1, got ${JSON.stringify(p.focus)}`);
  if (errors.length) return { errors, warnings };
  if (info.clips === undefined) return { errors, warnings };
  const clip = info.clips[p.src];
  if (!clip) { errors.push(`footage: no clip at footage/${p.src}/clip.json`); return { errors, warnings }; }
  if (info.strict && p.speed > 0 && info.beatT && Number.isFinite(info.t1)) {
    const span = info.t1 - info.beatT(info.row.at), left = (clip.duration - startTime(p, info)) / p.speed;
    const hold = span - Math.max(0, left);
    const seam = info.seam ? ' (at the loop seam: set from, or end on a non-footage row)' : '';
    if (hold >= 0.05) warnings.push(`${p.src} holds its last frame for ${+hold.toFixed(1)} s (footage at beat ${info.at})${seam}`);
  }
  return { errors, warnings };
}

// A cursor target on this row that cannot be right for its clip (a step the capture never named): the reason, else null.
export function checkTarget(name, p, { clips } = {}) {
  const clip = clips?.[p.src];
  if (!clip || !name.startsWith('step:')) return null;
  const want = name.slice(5), names = clip.steps.map((s) => s.name);
  if (names.includes(want)) return null;
  return `the clip footage/${p.src} has no step "${want}" (${names.length ? `steps: ${names.join(', ')}` : 'it has no steps: only capture.mjs names them; aim with point:X,Y'})`;
}
