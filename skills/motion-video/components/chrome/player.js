// player.js -- a now-playing card: artwork, title and artist, play/pause, and a scrubbable progress bar.
import { el, frame, icon, prog, fade, applyFade, pressesOn, pressDepth } from '../core/helpers.js';

export const meta = {
  name: 'player', group: 'chrome',
  useWhen: 'Media is playing or about to: a song, a podcast, a voice note.',
  motion: "A press on `play` swaps the play and pause icons (crossfade with a small scale) and starts or stops playback; while playing the position runs on with the clock (duration in seconds). Between a press 'down' on `thumb` and the next 'up' the thumb follows the cursor, and playback resumes from the release. A following player row carries on from where playback got to; if it writes a different `position` from the row before, it seeks there on arrival (the thumb glides). It plays or pauses on arrival if `playing` differs and crossfades a changed title or artist.",
  props: { title: ['string', 'Tints'], artist: ['string', 'Artist'], playing: ['boolean', false], position: ['number', 0.25], duration: ['number', 214] },
  hotspots: ['play', 'thumb'],
  sounds: [],
  example: "{ at: 0, use: 'player', title: 'Tints', artist: 'Anderson .Paak', position: 0.4 }",
  edgeCases: [{ playing: true, position: 0 }, { title: 'A very long track title that will not fit on the card', artist: 'Somebody with a long name', position: 1 }, { position: 0.5, duration: 3725 }],
};

const W = 820, H = 260, PAD = 40, ART = 180, COL = PAD + ART + 32, BTN = 72, TRACK = W - PAD - COL, TRACK_Y = 172, THUMB = 24;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function geometry() {
  return { w: W, h: H, r: 40, fill: 'surface', ink: 'ink' };
}

// Title and artist, stacked left of the play button.
function metaBlock(f, p, cls) {
  const m = el(f, 'div', { class: `pl-meta ${cls}` });
  Object.assign(m.style, { position: 'absolute', left: `${COL}px`, top: '50px', width: `${W - PAD - BTN - 24 - COL}px` });
  const line = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  Object.assign(el(m, 'div', { class: 'pl-title' }, p.title).style, line, { font: '500 34px var(--font)', lineHeight: '44px', letterSpacing: '-0.01em' });
  Object.assign(el(m, 'div', { class: 'pl-artist' }, p.artist).style, line, { font: '400 28px var(--font)', lineHeight: '36px', color: 'var(--muted)' });
}

export function mount(root, p, ctx) {
  const f = frame(root, 'pl', W, H);
  const art = el(f, 'div', { class: 'pl-art' });
  Object.assign(art.style, { position: 'absolute', left: `${PAD}px`, top: `${PAD}px`, width: `${ART}px`, height: `${ART}px`, borderRadius: '24px',
    display: 'grid', placeItems: 'center', background: 'var(--accent)', color: 'var(--surface)' });
  icon(art, 'music', 72);
  if (ctx.continues && (ctx.prev.title !== p.title || ctx.prev.artist !== p.artist)) metaBlock(f, ctx.prev, 'pl-prev');
  metaBlock(f, p, 'pl-cur');
  const ctl = el(f, 'div', { class: 'pl-ctl' });
  Object.assign(ctl.style, { position: 'absolute', inset: '0' });
  const btn = el(ctl, 'div', { class: 'pl-btn' });
  Object.assign(btn.style, { position: 'absolute', left: `${W - PAD - BTN}px`, top: '55px', width: `${BTN}px`, height: `${BTN}px`, borderRadius: '50%',
    background: 'var(--ink)', color: 'var(--surface)', display: 'grid', placeItems: 'center' });
  for (const name of ['play', 'pause']) {
    const s = icon(btn, name, 32);
    s.classList.add(`pl-${name}`);
    s.style.gridArea = '1 / 1';
  }
  const bar = { position: 'absolute', left: `${COL}px`, top: `${TRACK_Y - 4}px`, height: '8px', borderRadius: '4px' };
  Object.assign(el(ctl, 'div', { class: 'pl-track' }).style, bar, { width: `${TRACK}px`, background: 'color-mix(in srgb, var(--muted) 25%, transparent)' });
  Object.assign(el(ctl, 'div', { class: 'pl-fill' }).style, bar, { background: 'var(--ink)' });
  Object.assign(el(ctl, 'div', { class: 'pl-thumb' }).style, { position: 'absolute', top: `${TRACK_Y - THUMB / 2}px`, width: `${THUMB}px`, height: `${THUMB}px`,
    borderRadius: '50%', background: 'var(--ink)' });
  const time = { position: 'absolute', top: `${TRACK_Y + 18}px`, font: '500 22px var(--font)', lineHeight: '28px', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' };
  Object.assign(el(ctl, 'div', { class: 'pl-elapsed' }).style, time, { left: `${COL}px` });
  Object.assign(el(ctl, 'div', { class: 'pl-left' }).style, time, { right: `${PAD}px` });
}

// Playing at the start (the previous row's end state when continuing) and each time it flips: arriving with a
// different `playing`, and every press on play.
function plays(p, ctx) {
  const start = ctx.continues ? ctx.prev.playing : p.playing, flips = [];
  if (ctx.continues && p.playing !== start) flips.push(ctx.t0);
  for (const pr of pressesOn(ctx, 'play')) if (pr.kind !== 'up') flips.push(pr.t);
  return { start, flips: flips.sort((a, b) => a - b) };
}
const playingAt = (pl, t) => (pl.flips.filter((x) => x <= t).length % 2 ? !pl.start : pl.start);

// Each drag: a press 'down' on the thumb and the next 'up' routed to this row.
function drags(ctx) {
  const all = [...ctx.presses].sort((a, b) => a.t - b.t);
  return all.flatMap((d, i) => (d.kind === 'down' && d.hotspot === 'thumb' ? [{ down: d, up: all.slice(i + 1).find((u) => u.kind === 'up') ?? null }] : []));
}

// A continuation seeks when its written position differs from the previous row's written one; else it carries on.
const seeks = (p, ctx) => ctx.continues && ctx.prev.written !== p.position;
const startPos = (p, ctx) => clamp01(ctx.continues && !seeks(p, ctx) ? ctx.prev.position : p.position);

// Position 0..1 at t: it runs on at 1/duration a second while playing (from 0 for row 0, else the row's start),
// follows the cursor while the thumb is held, and carries on from the release.
function position(p, ctx, t) {
  const pl = plays(p, ctx), dur = Math.max(1, p.duration);
  let pos = startPos(p, ctx), at = ctx.settled ? 0 : ctx.t0;
  const run = (e) => {
    for (const f of [...pl.flips.filter((x) => x > at && x < e), e]) {
      if (f > at && playingAt(pl, at)) pos = clamp01(pos + (f - at) / dur);
      at = Math.max(at, f);
    }
  };
  for (const { down, up } of drags(ctx)) {
    if (t < down.t) break;
    run(down.t);
    const grab = pos, x0 = ctx.cursorAt(down.t).x;
    const follow = (tt) => clamp01(grab + (ctx.cursorAt(tt).x - x0) / TRACK);
    if (!up || t < up.t) return follow(t);
    pos = follow(up.t);
    at = up.t;
  }
  run(t);
  return pos;
}

// The row as it stands when the next row starts: a following player row carries on from here.
// `written` keeps the row's own position so the next row can tell a seek from carrying on.
export const endState = (p, ctx) => ({ ...p, playing: playingAt(plays(p, ctx), Infinity), position: position(p, ctx, Math.min(ctx.t1, 1e6)), written: p.position });

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function render(root, p, ctx, t) {
  const f = root.firstChild, bs = ctx.beat_sec, { Springs } = ctx;
  const pl = plays(p, ctx);
  let k = Springs.track(t, { from: pl.start ? 1 : 0, changes: pl.flips.map((x, i) => ({ t: x, to: (i % 2 ? pl.start : !pl.start) ? 1 : 0 })),
    omega: Springs.fromSettle(0.3 * bs, 1), zeta: 1 }).value;
  k = k > 0.999 ? 1 : k < 0.001 ? 0 : k;
  Object.assign(f.querySelector('.pl-play').style, { opacity: String(1 - k), transform: `scale(${(1 - 0.2 * k).toFixed(4)})` });
  Object.assign(f.querySelector('.pl-pause').style, { opacity: String(k), transform: `scale(${(0.8 + 0.2 * k).toFixed(4)})` });
  f.querySelector('.pl-btn').style.transform = `scale(${1 - 0.06 * pressDepth(ctx, t, pressesOn(ctx, 'play'))})`;
  const pos = position(p, ctx, t), dur = Math.max(1, p.duration), el0 = Math.floor(pos * dur);
  // A seek on arrival: the time reads the new position at once while the thumb glides over from the old one.
  const glide = seeks(p, ctx) ? (clamp01(ctx.prev.position) - startPos(p, ctx)) * (1 - prog(ctx, t, ctx.t0, 0.6)) : 0;
  const x = (pos + glide) * TRACK;
  f.querySelector('.pl-fill').style.width = `${x.toFixed(2)}px`;
  const held = drags(ctx).flatMap((d) => (d.up ? [d.down, d.up] : [d.down]));
  Object.assign(f.querySelector('.pl-thumb').style, { left: `${(COL + x - THUMB / 2).toFixed(2)}px`, transform: `scale(${1 + 0.25 * pressDepth(ctx, t, held)})` });
  f.querySelector('.pl-elapsed').textContent = mmss(el0);
  f.querySelector('.pl-left').textContent = `-${mmss(Math.max(0, Math.round(dur) - el0))}`;
  const pe = f.querySelector('.pl-prev'), cur = f.querySelector('.pl-cur');
  if (pe) {
    applyFade(pe, fade(ctx, t, -Infinity, ctx.t0));
    applyFade(cur, fade(ctx, t, ctx.t0 + 0.05 * bs));
  }
  if (!ctx.continues) {
    applyFade(f.querySelector('.pl-art'), fade(ctx, t, ctx.t0 + 0.1 * bs));
    applyFade(cur, fade(ctx, t, ctx.t0 + 0.16 * bs));
    applyFade(f.querySelector('.pl-ctl'), fade(ctx, t, ctx.t0 + 0.22 * bs));
  }
}

export function hotspot(name, p, geo, ctx) {
  if (name === 'play') return { x: W / 2 - PAD - BTN / 2, y: 55 + BTN / 2 - H / 2 };
  if (name === 'thumb') {
    const pos = ctx?.continues ? startPos(p, ctx) : clamp01(p.position);
    return { x: COL + pos * TRACK - W / 2, y: TRACK_Y - H / 2 };
  }
  return null;
}
