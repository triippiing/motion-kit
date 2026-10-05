// footage.js -- a clip (footage/<src>/: frame-00001.jpg ... and clip.json, made by footage.mjs or capture.mjs) playing
// inside the shape, frame-exact. Clip time is from + (t - t0) x speed, clamped to the clip (it holds the last frame) and
// frozen outside the row's window; frame n = round(clipT x fps) + 1: a pure function of t. render shows frame n and
// registers its decode with ctx.wait, so seek(t) resolves once the frame is on screen; callers that do not await
// (watch, sync, ?play) show it as soon as it decodes. A decode that fails keeps the last good frame and is raised with
// reportError (a page error: render.mjs exits 1 on it), while ctx.wait still sees its promise resolve.
// The page fetches each used clip's clip.json before ready (ctx.clips[src]); validation receives the same as data.
export const meta = {
  name: 'footage', group: 'media',
  useWhen: 'Real app footage: a capture (capture.mjs) or a screen recording (footage.mjs) playing in the shape, the cursor aimed at the steps the capture clicked.',
  motion: 'The clip plays from `from` seconds in at `speed` and holds its last frame when it runs out; the frame is a pure function of t. A following footage row of the same src carries on from where the clip had got to (unless it sets from) while the shape morphs.',
  props: { src: ['string', 'demo'], from: ['number', 0], speed: ['number', 1], fit: ['enum:cover|contain', 'cover'], width: ['number', 0] },
  hotspots: ['step:<name>', 'point:<x,y>'],
  hotspotExample: { 'step:<name>': 'step:Pay', 'point:<x,y>': 'point:0.5,0.5' },
  sounds: [],
  example: "{ at: 0, use: 'footage', src: 'demo' }",
  edgeCases: [{ src: 'demo', from: 1, speed: 0.5 }, { src: 'demo', fit: 'contain', w: 900, h: 900 }],
};

// width 0: fit the clip's aspect inside the stage (in design px) less MARGIN on every side. FALLBACK is the aspect
// used when there is no clip to read (validation without a project); the missing clip is reported by check().
const MARGIN = 0.1, R = 32, CACHE = 8;
const FALLBACK = { width: 1600, height: 900 };

export function geometry(p, ctx = {}) {
  const c = ctx.clips?.[p.src] ?? FALLBACK;
  const stage = ctx.stage ?? { width: 1440, height: 1440 };
  const K = Math.max(1, Math.min(stage.width, stage.height) / 1440);
  const bw = (stage.width / K) * (1 - 2 * MARGIN), bh = (stage.height / K) * (1 - 2 * MARGIN);
  const w = p.width > 0 ? p.width : Math.min(bw, (bh * c.width) / c.height);
  return { w: Math.round(w), h: Math.round((w * c.height) / c.width), r: R, fill: 'ink', ink: 'surface' };
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

export function endState(p, ctx) {
  return { ...p, _clipEnd: clipTime(p, ctx, ctx.t1 ?? Infinity) };
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

export function mount(root, p) {
  const img = root.appendChild(frameImg(p.fit));
  state.set(root, { img, want: 0, loading: new Map(), cache: new Map() });
}

export function render(root, p, ctx, t) {
  const clip = ctx.clips?.[p.src], st = state.get(root);
  if (!clip || !st) return;
  const n = frameIndex(clip, clipTime(p, ctx, t));
  if (n === st.want) {
    // Same frame as the last seek: wait on it again if it is still loading (an earlier seek nobody awaited).
    if (st.loading.has(n)) ctx.wait(st.loading.get(n));
    return;
  }
  st.want = n;
  const show = (img) => { if (st.img !== img) { root.replaceChild(img, st.img); st.img = img; } };
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
// through fit (cover crops, contain letterboxes) to the shape, as offsets from its centre. Without the clip
// (validation asks with ctx = {}) a step resolves at the centre: whether it exists is checkTarget's call.
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
  const k = (p.fit === 'contain' ? Math.min : Math.max)(geo.w / W, geo.h / H);
  return { x: (x - W / 2) * k, y: (y - H / 2) * k };
}

// Validation (validate.js), with the clips as data: info = { clips, strict, at (the row's beat, for messages), row,
// beatT (null: no timing, so no hold check), t1 (seconds; Infinity when unknown), continues, prev, seam (the last row
// of a looping piece) }. No clips
// (undefined): nothing to check against.
export function check(p, info) {
  const errors = [], warnings = [];
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
