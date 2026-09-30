// loader.js -- something is working: a spinning arc or three breathing dots.
import { el, fade, applyFade } from '../core/helpers.js';

export const meta = {
  name: 'loader', group: 'feedback',
  useWhen: 'Something is working: uploading, syncing, thinking, between a press and its result.',
  motion: 'The spinner turns at a steady 450 degrees a second; the dots brighten in turn on a 0.9 s cycle. Both run off the clock, so the motion carries on unbroken through a following loader row; a change of style there crossfades.',
  props: { style: ['enum:spinner|dots', 'spinner'] },
  hotspots: [],
  sounds: [],
  example: "{ at: 0, use: 'loader' }",
  edgeCases: [{ style: 'dots' }, { style: 'spinner' }],
};

const SVG = 48, DOT = 14, GAP = 10;

export function geometry() {
  return { w: 112, h: 112, r: 56, fill: 'ink', ink: 'surface' };
}

// One style's content, stacked in the layer's grid cell so a crossfade overlaps them.
function content(parent, p, cls) {
  const box = el(parent, 'div', { class: `ld-box ${cls}` });
  Object.assign(box.style, { gridArea: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: `${GAP}px` });
  if (p.style === 'dots') {
    for (let k = 0; k < 3; k++) Object.assign(el(box, 'div', { class: 'ld-dot' }).style, { width: `${DOT}px`, height: `${DOT}px`, borderRadius: '50%', background: 'currentColor' });
    return;
  }
  const s = el(box, 'svg:svg', { width: SVG, height: SVG, viewBox: `0 0 ${SVG} ${SVG}`, fill: 'none' });
  const arc = el(s, 'svg:circle', { class: 'ld-arc', cx: SVG / 2, cy: SVG / 2, r: 17, stroke: 'currentColor', 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-dasharray': '70 200' });
  Object.assign(arc.style, { transformBox: 'fill-box', transformOrigin: 'center' });
}

export function mount(root, p, ctx) {
  if (ctx.continues && ctx.prev.style !== p.style) content(root, ctx.prev, 'ld-prev');
  content(root, p, 'ld-cur');
}

// Both styles are functions of the absolute clock (row 0 therefore uses t), so a loader that carries on
// into a following loader row never jumps.
export function render(root, p, ctx, t) {
  for (const box of root.children) {
    const arc = box.querySelector('.ld-arc');
    if (arc) arc.style.transform = `rotate(${((t * 450) % 360).toFixed(3)}deg)`;
    box.querySelectorAll('.ld-dot').forEach((d, k) => { d.style.opacity = (0.35 + 0.65 * Math.max(0, Math.sin(2 * Math.PI * (t / 0.9) - k * 0.6))).toFixed(4); });
  }
  if (root.children.length === 2) {
    applyFade(root.children[0], fade(ctx, t, -Infinity, ctx.t0));
    applyFade(root.children[1], fade(ctx, t, ctx.t0 + 0.05 * ctx.beat_sec));
  }
}

export function hotspot() {
  return null;
}
