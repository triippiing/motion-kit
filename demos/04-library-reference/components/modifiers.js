// modifiers.js -- row keys usable on any row: shake (error shake) and badge (count bubble).
import { el, prog } from './core/helpers.js';

// Error shake: a short damped sine from the row's start. Deliberately underdamped; it is the one
// place motion-kit shakes, and only when a row asks for it.
export function shakeOffset(rows, t, base) {
  let dx = 0;
  for (const r of rows) {
    if (!r.row.shake || r.i === 0) continue;
    const tau = t - r.t0;
    if (tau < 0 || tau > 0.6) continue;
    dx += 14 * Math.exp(-tau * 9) * Math.sin(tau * 2 * Math.PI * 7);
  }
  return dx;
}

// A badge of 0 shows no bubble (nothing to count), so a row can clear the previous row's badge.
export function mountBadges(camera, rows, base) {
  return rows.filter((r) => r.row.badge != null && r.row.badge !== 0).map((r) => {
    const b = el(camera, 'div', { class: 'mk-badge' });
    Object.assign(b.style, { position: 'absolute', minWidth: '44px', height: '44px', padding: '0 12px', boxSizing: 'border-box',
      borderRadius: '22px', display: 'grid', placeItems: 'center', font: '600 22px var(--font)', background: 'var(--accent)',
      color: 'var(--surface)', boxShadow: '0 0 0 4px var(--canvas)', opacity: 0 });
    b.textContent = String(r.row.badge);
    return { el: b, r };
  });
}

export function renderBadges(badges, t, { w, h, dx, CX, CY, base }) {
  for (const { el: b, r } of badges) {
    const inT = r.i === 0 ? -1e6 : r.t0 + 0.4 * base.beat_sec;
    const pin = prog(base, t, inT, 0.4, 0.8), pout = t >= r.t1 ? prog(base, t, r.t1, 0.2) : 0;
    const s = Math.max(0, pin * (1 - pout));
    Object.assign(b.style, { opacity: s, left: `${CX + w / 2 - 30 + dx}px`, top: `${CY - h / 2 - 14}px`, transform: `scale(${0.6 + 0.4 * s})` });
  }
}
