#!/usr/bin/env node
// framecheck.mjs -- what a viewer would see as broken, measured in the real page at every beat and half beat:
// the cursor past a stage edge, text past (or clipped inside) its shape, and, for presets with safe zones, the
// shape or cursor inside a destination's UI zones (safezones.mjs's check, sharing these samples).
// Library only: check_brief.mjs runs it; safezones.mjs keeps the zone check's own CLI.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beatTime, openProject, UsageError } from './render.mjs';
import { loadPresets, resolvePresets, designStage, presetStage, scaledMargins } from './safezones.mjs';

const EDGES = ['top', 'bottom', 'left', 'right'], PARTS = ['shape', 'cursor'];

// Every beat (and half beat, the default) that starts inside the loop, with its time.
export function sampleTimes(song, samples = 'half') {
  const D = song.loop?.duration_sec ?? Infinity, out = [];
  for (let b = 0; b < song.beats.length; b++) for (const beat of samples === 'half' ? [b, b + 0.5] : [b]) {
    const t = beatTime(song, beat);
    if (t <= D + 1e-9) out.push({ beat, t });
  }
  return out;
}

// How far a box ({ left, top, right, bottom }, stage px) reaches into each margin of a W x H stage.
function intrusions(box, m, W, H) {
  const px = { top: m.top - box.top, bottom: box.bottom - (H - m.bottom), left: m.left - box.left, right: box.right - (W - m.right) };
  return EDGES.filter((e) => m[e] > 0 && px[e] >= 1).map((edge) => ({ edge, px: Math.round(px[edge]) }));
}

// Runs in the page: seek, then the shape's box and the cursor's in stage px (relative to #stage, which the
// viewport matches at device scale 1, so CSS px are stage px; getBoundingClientRect includes the camera zoom and the
// cursor's own scale). The cursor box runs from its tip (window.inspect) to the far corner of the arrow the engine
// draws (#cursor path: 23 x 33 px right of and below the tip at scale 1); a page without that path counts the tip.
// A cursor hidden by a `hide` row (inspect's opacity under 0.05) is not on screen, so it is null; a page
// whose inspect has no opacity (older projects) is always visible. seek's promise (media still loading) is awaited.
export async function measure(t) {
  await window.seek(t);
  const shape = document.querySelector('#shape');
  if (!shape) return null;
  const st = document.querySelector('#stage')?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const b = shape.getBoundingClientRect();
  const box = b.width > 0 && b.height > 0 ? { left: b.left - st.left, top: b.top - st.top, right: b.right - st.left, bottom: b.bottom - st.top } : null;

  // Text: every element in #shape with its own text. Skipped when (nearly) invisible: its opacity times every
  // ancestor's up to #shape under 0.05 (a crossfade), zero size, or marked data-overhang (a deliberate overhang,
  // e.g. a tooltip above its point). px are stage px: CSS px times the element's on-screen scale.
  // "Past its shape" measures the text's own line boxes (a Range over its text nodes), not the element's box: a
  // label is often a slot as tall as the shape, so a shape spring settling a px short of the row's size, or the
  // label's entrance slide, would push the empty slot past the edge while the words sit well inside. An element
  // that clips its overflow shows only what is inside its box, so the text is cut to that box (and reported as
  // clipped instead).
  const texts = [];
  if (box) for (const e of shape.querySelectorAll('*')) {
    const nodes = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!nodes.length) continue;
    if (e.closest('[data-overhang]')) continue;
    let o = 1;
    for (let a = e; a && a !== shape.parentElement; a = a.parentElement) o *= Number(getComputedStyle(a).opacity);
    const r = e.getBoundingClientRect();
    if (o < 0.05 || r.width === 0 || r.height === 0) continue;
    const scale = e.offsetWidth ? r.width / e.offsetWidth : 1;
    const g = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }, range = document.createRange();
    for (const n of nodes) {
      range.selectNodeContents(n);
      for (const q of range.getClientRects()) if (q.width > 0 && q.height > 0)
        Object.assign(g, { left: Math.min(g.left, q.left), top: Math.min(g.top, q.top), right: Math.max(g.right, q.right), bottom: Math.max(g.bottom, q.bottom) });
    }
    if (g.left === Infinity) continue;
    const cs = getComputedStyle(e);
    if (cs.overflowX !== 'visible') Object.assign(g, { left: Math.max(g.left, r.left), right: Math.min(g.right, r.right) });
    if (cs.overflowY !== 'visible') Object.assign(g, { top: Math.max(g.top, r.top), bottom: Math.min(g.bottom, r.bottom) });
    const over = Math.max(0, b.left - g.left, g.right - b.right, b.top - g.top, g.bottom - b.bottom);
    // Only an element that clips its overflow cuts text off: one that lets it spill shows it all (past its shape is
    // measured above). The clip is measured across only (scrollWidth); overflowY has no measurement to gate.
    const clip = cs.overflowX === 'visible' ? 0 : Math.max(0, (e.scrollWidth - e.clientWidth) * scale);
    if (over >= 1 || clip >= 1) texts.push({ text: e.textContent.trim(), over: Math.round(over), clip: Math.round(clip) });
  }

  const out = { stage: { W: st.width, H: st.height }, shape: box, cursor: null, texts };
  const c = typeof window.inspect === 'function' ? window.inspect(t)?.cursor : null;
  if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return out;
  if (Number.isFinite(c.opacity) && c.opacity < 0.05) return out;
  const a = document.querySelector('#cursor path')?.getBoundingClientRect();
  const cursor = { left: c.x, right: c.x, top: c.y, bottom: c.y };
  if (a && a.width > 0) Object.assign(cursor, { right: Math.max(c.x, a.right - st.left), bottom: Math.max(c.y, a.bottom - st.top) });
  return { ...out, cursor };
}

const cut = (s) => (s.length > 24 ? `${s.slice(0, 24)}…` : s);

// { issues, notes } -- issues are { kind: 'cursor', beat, through, t, edge, px }, { kind: 'text', beat, through, t,
// text, px, how: 'past'|'clipped' } (frame: true, at the design stage) and { kind: 'zone', preset, beat, through, t,
// part, edge, px } (each preset with safe zones, at its own stage). `beat` is where a run of samples with the same
// issue starts, `through` where it ends, px the most it reaches. `tables` (a brief's states()/cursor() code) is
// spliced into index.html as served, so a brief is checked before it is built; notes say when that was not possible.
// `loop` (a boolean) overrides project.json's "loop" as served (check_brief --no-loop).
export async function checkFrames(dir, { tables, loop, presets = [], frame = true, samples = 'half' } = {}) {
  const root = path.resolve(dir);
  if (!existsSync(path.join(root, 'song.json'))) throw new UsageError(`${root} is not a motion-video project (no song.json)`);
  if (!['beats', 'half'].includes(samples)) throw new UsageError(`samples must be "beats" or "half", got "${samples}"`);
  // The zone check alone (safezones.mjs) still needs at least one preset, as it always has.
  const P = presets.length || !frame ? await loadPresets() : null;
  const names = P ? resolvePresets(P, presets) : [];
  const design = await designStage(root);
  let song;
  try { song = JSON.parse(await readFile(path.join(root, 'song.json'), 'utf8')); }
  catch (e) { throw new UsageError(`song.json is not valid JSON: ${e.message}`); }
  if (!Array.isArray(song?.beats)) throw new UsageError('song.json has no beats list (re-run analyze_song.py)');
  const at = sampleTimes(song, samples);

  // One browser session per stage size: the design stage carries the frame checks, each preset's stage its zones.
  const groups = new Map();
  if (frame) groups.set(design.join('x'), { stage: design, frame: true, zones: [] });
  for (const name of names) {
    const stage = presetStage(P, name, design), m = scaledMargins(P.presets[name], stage);
    if (!m) continue;
    const key = stage.join('x');
    if (!groups.has(key)) groups.set(key, { stage, frame: false, zones: [] });
    groups.get(key).zones.push({ name, m });
  }

  const what = frame ? 'frame' : 'safe-zone';
  const issues = [], notes = [];
  for (const { stage, frame: framed, zones } of groups.values()) {
    const proj = await openProject(root, { workers: 1, stage, tables, loop });
    try {
      if (tables && !proj.tablesSpliced && !notes.length) notes.push(`index.html has no table markers, so the ${what} check used index.html's own tables, not the brief's`);
      const [W, H] = stage, page = proj.pages[0];
      const open = new Map();   // issue key -> the issue its run is building
      // Consecutive samples with the same key are one issue: extend its run and keep the deepest px (and the
      // wording, past or clipped, of the sample that gave it). A second hit in the same sample (the same text
      // shown twice) joins the run too.
      const hit = (i, key, fields) => {
        const run = open.get(key);
        if (run && run.last >= i - 1) {
          if (fields.px > run.px) Object.assign(run, { px: fields.px }, fields.how && { how: fields.how });
          run.through = at[i].beat; run.last = i; return;
        }
        const issue = { ...fields, beat: at[i].beat, through: at[i].beat, t: Math.round(at[i].t * 1000) / 1000, last: i };
        open.set(key, issue); issues.push(issue);
      };
      for (let i = 0; i < at.length; i++) {
        const got = await page.evaluate(measure, at[i].t);
        if (proj.errors.length) throw proj.errors[0];
        if (!got) throw new Error(`the ${what} check needs the template's #shape element; index.html has none`);
        if (framed && got.cursor) {
          const c = got.cursor, px = { left: -c.left, top: -c.top, right: c.right - W, bottom: c.bottom - H };
          for (const edge of EDGES) if (px[edge] >= 1) hit(i, `cursor/${edge}`, { kind: 'cursor', edge, px: Math.round(px[edge]) });
        }
        if (framed) for (const { text, over, clip } of got.texts) {
          hit(i, `text/${text}`, { kind: 'text', text: cut(text), px: Math.max(over, clip), how: over >= clip ? 'past' : 'clipped' });
        }
        for (const { name, m } of zones) for (const part of PARTS) {
          if (!got[part]) continue;
          for (const { edge, px } of intrusions(got[part], m, W, H)) hit(i, `${name}/${part}/${edge}`, { kind: 'zone', preset: name, part, edge, px });
        }
      }
    } finally { await proj.close(); }
  }
  const KINDS = ['zone', 'cursor', 'text'];
  issues.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)
    || (a.kind === 'zone' ? names.indexOf(a.preset) - names.indexOf(b.preset) : 0) || a.beat - b.beat
    || PARTS.indexOf(a.part) - PARTS.indexOf(b.part) || EDGES.indexOf(a.edge) - EDGES.indexOf(b.edge));
  return { issues: issues.map(({ last, ...i }) => i), notes };
}

const beats = (i) => (i.through > i.beat ? `beats ${i.beat}-${i.through}` : `beat ${i.beat}`);

// "beats 12-13.5: the cursor goes 40 px past the right edge"; "beat 8: text "..." runs 64 px past its shape".
export function frameIssueText(i) {
  if (i.kind === 'cursor') return `${beats(i)}: the cursor goes ${i.px} px past the ${i.edge} edge`;
  return `${beats(i)}: text "${i.text}" ${i.how === 'past' ? `runs ${i.px} px past its shape` : `is cut off by ${i.px} px`}`;
}
