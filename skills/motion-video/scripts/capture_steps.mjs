// capture_steps.mjs -- the steps of a capture (capture.mjs): checking a steps list, laying it out on frames, and
// playing it into a Playwright page one frame at a time.
//
// A steps list is [{ "wait": SEC } | { "click": SEL } | { "hover": SEL } | { "type": SEL, "text": STR } |
// { "scroll": PX } | { "scroll": PX, "in": SEL }], each optionally "name"d (names are unique; a named step lands in
// clip.json with its time and box). The pointer moves to a target's centre over "move" seconds (default 0.4) on an
// ease-in-out straight line, found when the step begins (5 s to appear, else exit 1); then a click is a press and
// release there, a hover just arrives, a type clicks to focus and types "cps" characters a second (default 12, one
// key per due frame), and a scroll in an element turns the wheel there by PX over 0.3 s. A scroll without "in" turns
// it wherever the pointer is. A selector matching several elements uses the first; one Playwright cannot parse is
// bad input (exit 2), checked before the first frame. Steps run back to back after a 0.5 s hold, and a 0.5 s hold
// ends the clip. All times are laid out on frames up front (round(t * fps)), so a step lands on the same frame on
// every run.
import { UsageError } from './render.mjs';

export const HOLD = 0.5, MOVE = 0.4, CPS = 12, WHEEL = 0.3, FIND_MS = 5000;
const ACTIONS = ['wait', 'click', 'type', 'scroll', 'hover'];
const EXTRA = { wait: [], click: ['move'], hover: ['move'], type: ['text', 'move', 'cps'], scroll: ['in', 'move'] };

// A step that failed in the page (exit 1, not a usage error).
export class StepError extends Error {}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const selector = (x) => typeof x === 'string' && x.trim() !== '';

// Check a parsed steps list; returns normalised steps { n, action, sel, name, wait, move, text, cps, px, label }.
export function checkSteps(list) {
  if (!Array.isArray(list)) throw new UsageError('the steps file must hold a list of steps, e.g. [{"click": "#pay"}]');
  const names = new Set();
  return list.map((raw, k) => {
    const n = k + 1, bad = (msg) => { throw new UsageError(`step ${n}${msg}`); };
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) bad(' must be an object, e.g. {"click": "#pay"}');
    const known = (key) => key === 'name' || ACTIONS.includes(key) || Object.values(EXTRA).some((ks) => ks.includes(key));
    for (const key of Object.keys(raw)) if (!known(key)) bad(`: unknown key "${key}"`);
    const acts = Object.keys(raw).filter((key) => ACTIONS.includes(key));
    if (!acts.length) bad(` has no action (one of ${ACTIONS.join(', ')})`);
    if (acts.length > 1) bad(` has two actions (${acts.join(', ')}); give each its own step`);
    const action = acts[0], v = raw[action];
    for (const key of Object.keys(raw)) {
      if (key !== action && key !== 'name' && !EXTRA[action].includes(key)) bad(`: "${key}" does not go with ${action}`);
    }
    const s = { n, action, name: raw.name ?? null, move: raw.move ?? MOVE };
    if (s.name != null && !selector(s.name)) bad(': "name" must be a non-empty string');
    if (s.name != null) {
      if (names.has(s.name)) bad(`: the step name "${s.name}" is used twice (step names must be unique)`);
      names.add(s.name);
    }
    if (!isNum(s.move) || s.move < 0) bad(`: "move" must be a number of seconds >= 0, got ${JSON.stringify(raw.move)}`);
    if (action === 'wait') {
      if (!isNum(v) || v < 0) bad(`: "wait" must be a number of seconds >= 0, got ${JSON.stringify(v)}`);
      s.wait = v;
    } else if (action === 'scroll') {
      if (!isNum(v) || v === 0) bad(`: "scroll" must be a non-zero number of pixels (down is positive), got ${JSON.stringify(v)}`);
      if (raw.in != null && !selector(raw.in)) bad(': "in" must be a selector');
      s.px = v; s.sel = raw.in ?? null;
    } else {
      if (!selector(v)) bad(`: "${action}" must be a selector, got ${JSON.stringify(v)}`);
      s.sel = v;
    }
    if (action === 'type') {
      if (typeof raw.text !== 'string' || !raw.text) bad(': a type step needs "text", a non-empty string');
      s.text = raw.text; s.cps = raw.cps ?? CPS;
      if (!isNum(s.cps) || s.cps <= 0) bad(`: "cps" must be a number of characters a second > 0, got ${JSON.stringify(raw.cps)}`);
    }
    s.label = `step ${n} (${action} ${s.sel != null ? JSON.stringify(s.sel) : JSON.stringify(v)})`;
    return s;
  });
}

// Lay checked steps out on frame indices (0-based; frame i is clip time i / fps). Each step gets begin (its target is
// found then), arrive (the pointer is there: the click, focus or first wheel turn), keys [[frame, char]], wheel
// [[frame, dy]] and last (its last frame with work). Returns { steps, frames }.
export function planSteps(steps, fps) {
  const at = (t) => Math.round(t * fps);
  let t = HOLD, lastAction = 0;
  const planned = steps.map((s) => {
    const p = { ...s, begin: at(t), keys: [], wheel: [] };
    const pointer = s.action !== 'wait' && (s.action !== 'scroll' || s.sel != null);
    const move = pointer ? s.move : 0;
    p.arrive = at(t + move);
    let dur = move;
    if (s.action === 'wait') dur = s.wait;
    if (s.action === 'type') {
      [...s.text].forEach((ch, j) => p.keys.push([at(t + move + j / s.cps), ch]));
      dur += [...s.text].length / s.cps;
    }
    if (s.action === 'scroll') {
      const w = Math.max(1, at(t + move + WHEEL) - p.arrive);
      for (let j = 0; j < w; j++) p.wheel.push([p.arrive + j, Math.round((s.px * (j + 1)) / w) - Math.round((s.px * j) / w)]);
      dur += WHEEL;
    }
    p.pointer = pointer;
    p.last = Math.max(p.arrive, ...p.keys.map(([f]) => f), ...p.wheel.map(([f]) => f));
    lastAction = Math.max(lastAction, p.last);
    t += dur;
    return p;
  });
  return { steps: planned, frames: Math.max(1, at(t + HOLD), lastAction + 1) };
}

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);   // ease-in-out cubic

// Plays planned steps into a page: call frame(i) for every frame in order, before that frame's screenshot. The pointer
// starts at the viewport's centre (call start() once, before frame 0; it also checks every selector parses). Named
// steps are collected in `record` as { name, action, t, box } with the box in clip pixels (CSS pixels x scale), read
// on the action's frame (where the target was found, if it has gone by then; the viewport for a wait or a scroll
// without "in"). t is clock(i), the frame's clip time i / fps unless the caller measures it (realtime capture).
export class StepRunner {
  constructor(page, plan, { fps, size, scale, clock = (i) => i / fps }) {
    Object.assign(this, { page, plan, fps, size, scale, clock, record: [] });
    this.pointer = { x: size[0] / 2, y: size[1] / 2 };
  }

  async start() {
    for (const s of this.plan.steps) {
      if (s.sel == null) continue;
      try { await this.page.locator(s.sel).count(); } catch (e) {
        throw new UsageError(`${s.label}: Playwright cannot parse the selector (${String(e.message).split('\n')[0].replace(/^locator\.count: /, '')})`);
      }
    }
    await this.page.mouse.move(this.pointer.x, this.pointer.y);
  }

  async frame(i) {
    for (const s of this.plan.steps) if (s.begin <= i && i <= s.last) await this.#step(s, i);
  }

  async #step(s, i) {
    const { mouse, keyboard } = this.page;
    if (i === s.begin && s.pointer) {
      const box = s.found = await this.#find(s);
      s.from = { ...this.pointer };
      s.to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    if (s.pointer && i <= s.arrive && (i > s.begin || s.arrive === s.begin)) {
      const k = s.arrive === s.begin ? 1 : ease((i - s.begin) / (s.arrive - s.begin));
      this.pointer = { x: s.from.x + (s.to.x - s.from.x) * k, y: s.from.y + (s.to.y - s.from.y) * k };
      await mouse.move(this.pointer.x, this.pointer.y);
    }
    if (i === (s.action === 'wait' ? s.begin : s.arrive)) {
      if (s.name != null) await this.#record(s, i);
      if (s.action === 'click' || s.action === 'type') { await mouse.down(); await mouse.up(); }
    }
    for (const [f, ch] of s.keys) if (f === i) await keyboard.type(ch);
    for (const [f, dy] of s.wheel) if (f === i) await mouse.wheel(0, dy);
  }

  // The step's target box (CSS pixels) once it is attached, visible and its centre is in the viewport.
  async #find(s) {
    let box;
    try { box = await this.page.locator(s.sel).first().boundingBox({ timeout: FIND_MS }); } catch (e) {
      if (e.name === 'TimeoutError') throw new StepError(`${s.label}: no element matches (waited ${FIND_MS / 1000} s)`);
      throw new StepError(`${s.label}: ${String(e.message).split('\n')[0]}`);
    }
    if (!box) throw new StepError(`${s.label}: the element is not visible`);
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    if (cx < 0 || cy < 0 || cx >= this.size[0] || cy >= this.size[1]) {
      throw new StepError(`${s.label}: the element's centre (${cx.toFixed(0)}, ${cy.toFixed(0)}) is outside the ${this.size.join('x')} viewport; scroll to it first`);
    }
    return box;
  }

  async #record(s, i) {
    let box = s.found ?? { x: 0, y: 0, width: this.size[0], height: this.size[1] };
    const loc = s.sel != null && this.page.locator(s.sel).first();
    if (loc && await loc.count()) box = (await loc.boundingBox({ timeout: 1000 }).catch(() => null)) ?? box;   // gone: where it was found
    const k = this.scale, r = (x) => Math.round(x * k * 100) / 100;
    this.record.push({ name: s.name, action: s.action, t: this.clock(i), box: { x: r(box.x), y: r(box.y), w: r(box.width), h: r(box.height) } });
  }
}
