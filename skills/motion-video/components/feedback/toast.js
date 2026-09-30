// toast.js -- a short confirmation pill: an icon, a message and an optional action.
import { el, textW, frame, icon, fade, applyFade, cssRole, pressesOn, pressDepth } from '../core/helpers.js';

export const meta = {
  name: 'toast', group: 'feedback',
  useWhen: 'The app confirms something briefly: saved, copied, moved to archive (with Undo).',
  motion: 'The content rises 12px and unblurs as it fades in after the shape arrives. A press on the action dips it. A following toast row crossfades changed content the same way.',
  props: { text: ['string', 'Saved'], icon: ['enum:check|info|none', 'check'], action: ['string', ''] },
  hotspots: ['toast', 'action'],
  sounds: [],
  example: "{ at: 0, use: 'toast', text: 'Moved to archive', action: 'Undo' }",
  edgeCases: [{ text: 'Copied', icon: 'none' }, { text: 'Your export is ready to download from the reports page', icon: 'info', action: 'Open' }, { text: 'Saved' }],
};

const H = 88, DOT = 48, GAP = 20, ACT_GAP = 40;
const actionW = (p) => (p.action ? textW(p.action, 26) : 0);
// Estimated content width; the geometry adds 104 px of padding, split evenly either side.
const contentW = (p) => (p.icon !== 'none' ? DOT + GAP : 0) + textW(p.text, 28) + (p.action ? ACT_GAP + actionW(p) : 0);

export function geometry(p) {
  return { w: Math.min(1300, 64 + contentW(p) + 40), h: H, r: H / 2, fill: 'ink', ink: 'surface' };
}

// One set of content in a frame of that row's width: icon, message and action in a row centred in
// the pill (a long message ellipses before the action is squeezed).
function content(parent, p, cls, w, ctx) {
  const f = frame(parent, `ts-row ${cls}`, w, H);
  Object.assign(f.style, { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 32px', boxSizing: 'border-box' });
  if (p.icon !== 'none') {
    const dot = el(f, 'div', { class: 'ts-icon' });
    Object.assign(dot.style, { flex: 'none', width: `${DOT}px`, height: `${DOT}px`, marginRight: `${GAP}px`, borderRadius: '50%',
      display: 'grid', placeItems: 'center', background: cssRole(ctx, 'pos', 'accent'), color: 'var(--surface)' });
    icon(dot, p.icon, 28);
  }
  Object.assign(el(f, 'span', { class: 'ts-text' }, p.text).style, { font: '400 28px var(--font)', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis' });
  if (p.action) {
    Object.assign(el(f, 'span', { class: 'ts-action' }, p.action).style, { flex: 'none', marginLeft: `${ACT_GAP}px`, font: '500 28px var(--font)',
      textDecoration: 'underline', textUnderlineOffset: '6px', textDecorationThickness: '2px' });
  }
}
const changed = (a, b) => a.text !== b.text || a.icon !== b.icon || a.action !== b.action;

export function mount(root, p, ctx) {
  if (ctx.continues && changed(ctx.prev, p)) content(root, ctx.prev, 'ts-prev', ctx.geo.w, ctx);
  content(root, p, 'ts-cur', ctx.geo.w, ctx);
}

export function render(root, p, ctx, t) {
  const rows = root.querySelectorAll('.ts-row'), bs = ctx.beat_sec;
  if (rows.length === 2) {
    applyFade(rows[0], fade(ctx, t, -Infinity, ctx.t0));
    applyFade(rows[1], fade(ctx, t, ctx.t0 + 0.05 * bs));
  } else applyFade(rows[0], fade(ctx, t, ctx.continues ? -Infinity : ctx.t0 + 0.15 * bs));
  const a = rows[rows.length - 1].querySelector('.ts-action');
  if (a) a.style.transform = `scale(${1 - 0.06 * pressDepth(ctx, t, pressesOn(ctx, 'action'))})`;
}

export function hotspot(name, p, geo) {
  if (name === 'toast') return { x: 0, y: 0 };
  if (name === 'action') return p.action ? { x: contentW(p) / 2 - actionW(p) / 2, y: 0 } : null;
  return null;
}
