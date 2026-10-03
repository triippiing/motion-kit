// validate.js -- one set of rules for runtime errors (engine) and brief checks (check_brief.mjs).
import { resolveRows } from './timing.js';
// `offset` goes with a marker `at` and is gone once resolved; `marker` is the name a resolved row came from.
export const RESERVED = new Set(['at', 'offset', 'marker', 'use', 'name', 'w', 'h', 'r', 'fill', 'ink', 'shake', 'badge']);
const CURSOR_KEYS = new Set(['at', 'offset', 'marker', 'x', 'y', 'target', 'dx', 'dy', 'press', 'sound', 'hide']);

export function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function didYouMean(x, list) {
  let best = null, bestD = Math.max(2, Math.ceil(String(x).length / 3)) + 1;
  for (const c of list) { const k = lev(String(x), c); if (k < bestD) { bestD = k; best = c; } }
  return best;
}

// m:ss of a time in seconds, for messages.
const mss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
// The words for one resolveRows error ({ index, error: MarkerError }) in table `what` ('states()' or 'cursor()').
// The engine and validate both use this, so the wording lives here only.
export function markerMessage({ index, error: e }, what) {
  const name = typeof e.markerName === 'string' ? `'${e.markerName}'` : describe(e.markerName);
  let text;
  if (e.reason === 'outside') text = `marker ${name} is outside the loop (at ${mss(e.marker.song_t ?? e.marker.t)} in the song)`;
  else if (e.reason === 'not-a-name') {
    const n = typeof e.markerName === 'string' && e.markerName.trim() !== '' ? Number(e.markerName) : NaN;
    text = `at: ${name} is not a marker: markers start with a letter${Number.isFinite(n) ? ` (for beat ${n} write at: ${n})` : ''}`;
  } else if (e.reason === 'offset') text = `offset for marker ${name} should be a number of beats, got ${describe(e.offset)}`;
  else {
    const s = didYouMean(e.markerName, e.known);
    text = `unknown marker ${name} (${s ? `did you mean '${s}'?` : e.known.length ? `markers: ${e.known.join(', ')}` : 'song.json has no markers; mark them with sync.mjs DIR'})`;
  }
  return `${what} row ${index + 1}: ${text}`;
}

export function typeOk(spec, v) {
  if (spec === 'any') return true;
  if (spec.startsWith('enum:')) return spec.slice(5).split('|').includes(v);
  switch (spec) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    case 'string[]': return Array.isArray(v) && v.every((x) => typeof x === 'string');
    case 'number[]': return Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));
    case 'object': return !!v && typeof v === 'object' && !Array.isArray(v);
    case 'object[]': return Array.isArray(v) && v.every((x) => !!x && typeof x === 'object' && !Array.isArray(x));
    default: return false;
  }
}

export function matchHotspot(patterns, target) {
  return patterns.some((p) => {
    const i = p.indexOf(':<');
    return i < 0 ? p === target : target.startsWith(p.slice(0, i + 1)) && target.length > i + 1;
  });
}

// A registry entry by own key only (`constructor` is not a component).
export const lookup = (registry, name) => (registry && Object.hasOwn(registry, name) ? registry[name] : undefined);

// Index of the row active at beat `at`. rows: [{ row, comp }] in order.
export function activeIndex(rows, at) {
  let k = 0;
  rows.forEach((r, i) => { if (r.row.at <= at + 1e-9) k = i; });
  return k;
}

// The rows a cursor row at beat `at` may aim at: the active row, plus the next row
// if it starts within one beat (a press landing on the beat a state starts).
function candidates(rows, at) {
  const k = activeIndex(rows, at), next = rows[k + 1];
  return next && next.row.at - at <= 1 + 1e-9 ? [rows[k], next] : [rows[k]];
}

// A component row's props with its defaults filled in (what the engine renders).
export function rowProps(row, comp) {
  const props = {};
  for (const [k, [, def]] of Object.entries(comp.meta.props)) props[k] = Object.hasOwn(row, k) ? row[k] : structuredClone(def);
  return props;
}
// A component row's shape: the component's geometry with the row's w/h/r/fill/ink overrides.
export function rowGeo(row, comp, props, ctx = {}) {
  const g = comp.geometry(props, ctx);
  return { w: row.w ?? g.w, h: row.h ?? g.h, r: row.r ?? g.r, fill: row.fill ?? g.fill ?? 'surface', ink: row.ink ?? g.ink ?? 'ink' };
}

// Where hotspot `name` sits on row r ({ row, comp, props, geo }), or null when the row has no such
// hotspot with its props (a tab not in items, a row index past the end, an item of a closed dropdown).
// It is asked without a ctx: rows are chosen before any row has one, so hotspot() must not need ctx
// to decide whether a hotspot exists. A row flagged `bad` (its props are already reported) is not asked.
export function resolveHotspot(r, name) {
  if (!r?.comp || !matchHotspot(r.comp.meta.hotspots, name)) return null;
  if (r.bad) return { x: 0, y: 0 };
  try {
    r.props ??= rowProps(r.row, r.comp);
    r.geo ??= rowGeo(r.row, r.comp, r.props);
    const p = r.comp.hotspot(name, r.props, r.geo, {});
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch { return null; }
}

// The row a cursor row aims at: the first candidate on which its hotspot resolves.
export function targetRow(rows, c) {
  return candidates(rows, c.at).find((r) => resolveHotspot(r, c.target)) ?? null;
}

// The row a cursor row acts on (presses): its target's row, else the active row.
export function pressRow(rows, c) {
  return (c.target && targetRow(rows, c)) || rows[activeIndex(rows, c.at)];
}

// A press aimed at one of its row's drag hotspots (meta.drag): with 'down', a drag, not a press-and-hold.
// The engine lands the pointer for these only (a custom state has no thumb to put under it).
export function isHotspotDrag(rows, c) {
  const r = c.target && targetRow(rows, c);
  return !!r && matchHotspot(r.comp.meta.drag ?? [], c.target);
}
// What validate treats as a drag: a hotspot drag, or any untargeted 'down' on a custom state (no `use`), whose
// press-and-drag is the author's own x/y moves.
export function isDrag(rows, c) {
  if (c.target) return isHotspotDrag(rows, c);
  return !pressRow(rows, c)?.row.use;
}

// Every hotspot name that resolves on row r: its plain hotspots, and each family ('tab:<item>') tried with
// every string in the row's props and the integers 0..99, so a message can list what is really there.
function resolvable(r) {
  const words = new Set();
  const add = (v) => { if (typeof v === 'string' && v) words.add(v); else if (Array.isArray(v)) v.forEach(add); else if (v && typeof v === 'object') Object.values(v).forEach(add); };
  Object.values(r.props ?? {}).forEach(add);
  for (let n = 0; n < 100; n++) words.add(String(n));
  const out = [];
  for (const h of r.comp.meta.hotspots) {
    const i = h.indexOf(':<');
    if (i < 0) { if (resolveHotspot(r, h)) out.push(h); continue; }
    for (const w of words) if (resolveHotspot(r, h.slice(0, i + 1) + w)) out.push(h.slice(0, i + 1) + w);
  }
  return out;
}
// A list of hotspot names for a message: runs of numbered names shortened to "row:0 to row:7", at most 12 entries.
function listNames(names) {
  const parts = [];
  for (let i = 0; i < names.length; i++) {
    const m = names[i].match(/^(.*:)(\d+)$/);
    let j = i;
    if (m) while (j + 1 < names.length && names[j + 1] === `${m[1]}${Number(m[2]) + (j + 1 - i)}`) j++;
    parts.push(j - i >= 2 ? `${names[i]} to ${names[j]}` : names[i]);
    if (j - i === 1) parts.push(names[j]);
    i = j;
  }
  return parts.length > 12 ? `${parts.slice(0, 12).join(', ')}, ...` : parts.join(', ');
}

// Stable JSON: object keys sorted at every level, so key order never matters.
const canon = (x) => Array.isArray(x) ? `[${x.map(canon).join(',')}]`
  : x && typeof x === 'object' ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canon(x[k])}`).join(',')}}`
  : JSON.stringify(x);
// A row with its component's defaults filled in (an explicitly written default equals an omitted one).
const withDefaults = (row, registry) => {
  const props = lookup(registry, row.use)?.meta?.props;
  if (!props) return row;
  const full = { ...row };
  for (const [k, [, def]] of Object.entries(props)) if (!Object.hasOwn(full, k)) full[k] = def;
  return full;
};
// Where a cursor row points: target/x/y plus its offset (an omitted dx/dy is 0).
const spot = (c) => canon({ target: c.target ?? null, x: c.x ?? null, y: c.y ?? null, dx: c.dx ?? 0, dy: c.dy ?? 0 });
// The marker a row was placed by is where it sits, not what it is, so it is left out like `at`.
const bare = ({ marker, ...row }) => row;
const same = (a, b, registry) => canon({ ...withDefaults(bare(a), registry), at: 0 }) === canon({ ...withDefaults(bare(b), registry), at: 0 });
// A cursor row for the seam: hide: false is the same as no hide.
const shown = ({ hide, ...c }) => (hide === false || hide === undefined ? c : { ...c, hide });

const HEX = /^#[0-9a-f]{6}$/i;
const describe = (v) => (v === undefined ? 'nothing' : typeof v === 'number' ? String(v) : JSON.stringify(v));
// A beat for messages: a marker's beat is fractional, so round it (whole beats print as before).
const num = (b) => +b.toFixed(3);
// A row's beat for messages: rounded, plus the marker it was placed by ("beat 9.309 ('drop')").
const B = (row) => (row?.marker ? `${num(row.at)} ('${row.marker}')` : num(row.at));

// Holes, non-object rows and rows without a finite `at` stop the check: nothing else can be read safely.
// A string `at` left after resolveRows is a marker that did not resolve, already reported.
function shapeErrors(list, what) {
  const errors = [];
  for (let i = 0; i < list.length; i++) {
    const after = i && Number.isFinite(list[i - 1]?.at) ? ` (after beat ${B(list[i - 1])})` : '';
    if (!(i in list)) errors.push(`${what} row ${i + 1}${after} is empty (a stray comma?)`);
    else if (!list[i] || typeof list[i] !== 'object' || Array.isArray(list[i])) errors.push(`${what} row ${i + 1}${after} should be an object like { at: 4, ... }, got ${describe(list[i])}`);
    else if (typeof list[i].at !== 'string' && !Number.isFinite(list[i].at)) errors.push(`${what} row ${i + 1}${after} needs a numeric \`at\` (a beat), got ${describe(list[i].at)}`);
  }
  return errors;
}

// theme: the colour roles ({ role: '#rrggbb', ... }); when given, fill/ink must name one of them or be #rrggbb.
// Rows whose `at` names a marker are resolved first (resolveRows), so every rule below sees beat numbers.
export function validate({ states: S, cursor: Cu, registry, song, theme, loop = true, strict = false }) {
  const errors = [], warnings = [];
  const done = () => ({ errors: [...new Set(errors)], warnings: [...new Set(warnings)] });
  const END = song?.beats?.length;
  if (!Array.isArray(S) || !S.length) return { errors: ['states() must return at least one row'], warnings };
  const rs = resolveRows(S, song), rc = resolveRows(Cu, song);
  const states = rs.rows, cursor = rc.rows;
  errors.push(...rs.errors.map((e) => markerMessage(e, 'states()')), ...rc.errors.map((e) => markerMessage(e, 'cursor()')));
  errors.push(...shapeErrors(states, 'states()'));
  if (Array.isArray(cursor)) errors.push(...shapeErrors(cursor, 'cursor()'));
  if (errors.length) return done();
  // A resolved row has no offset left: one still there sits on a numeric beat.
  for (const row of [...states, ...(cursor ?? [])]) if (Object.hasOwn(row, 'offset'))
    errors.push(`offset at beat ${B(row)} only goes with a marker, e.g. { at: 'drop', offset: -0.5 }`);
  const roles = theme ? Object.keys(theme).filter((k) => typeof theme[k] === 'string' && HEX.test(theme[k])) : null;
  // One entry per row, filled in as the rows are checked: props/geo for hotspots; bad when already reported.
  const rows = states.map((row) => ({ row, comp: row.use ? lookup(registry, row.use) : null, bad: false }));
  if (states[0].at !== 0) errors.push('first row must be at beat 0');
  states.forEach((row, i) => {
    const r = rows[i];
    if (i && !(row.at > states[i - 1].at)) errors.push(`rows must be in ascending beat order (beat ${B(row)} after ${B(states[i - 1])})`);
    for (const k of ['w', 'h', 'r']) if (Object.hasOwn(row, k) && !(Number.isFinite(row[k]) && row[k] >= 0)) { errors.push(`${k} at beat ${B(row)} should be a number >= 0, got ${describe(row[k])}`); r.bad = true; }
    for (const k of ['fill', 'ink']) {
      if (!Object.hasOwn(row, k)) continue;
      const v = row[k];
      if (typeof v !== 'string' || !(HEX.test(v) || (roles ? roles.includes(v) : true))) {
        errors.push(`${k} at beat ${B(row)} should be a theme role${roles ? ` (${roles.join(', ')})` : ''} or #rrggbb, got ${describe(v)}`);
        r.bad = true;
      }
    }
    if (row.use) {
      const comp = r.comp;
      if (!comp) {
        const s = didYouMean(row.use, Object.keys(registry));
        errors.push(`unknown component "${row.use}" at beat ${B(row)}${s ? `: did you mean "${s}"?` : ''} (see components/CATALOG.md)`);
        return;
      }
      const props = comp.meta.props;
      for (const [k, v] of Object.entries(row)) {
        if (RESERVED.has(k)) continue;
        if (!Object.hasOwn(props, k)) { errors.push(`unknown prop "${k}" for ${row.use} (props: ${Object.keys(props).join(', ') || 'none'})`); r.bad = true; continue; }
        if (!typeOk(props[k][0], v)) { errors.push(`prop "${k}" of ${row.use} should be ${props[k][0]}, got ${JSON.stringify(v)}`); r.bad = true; }
      }
      if (!r.bad) {
        r.props = rowProps(row, comp);
        try { r.geo = rowGeo(row, comp, r.props); } catch (e) { errors.push(`${row.use} at beat ${B(row)} cannot be sized: ${e.message}`); r.bad = true; }
      }
      // Typing that has not finished when the next row starts: that row continues from text never fully shown.
      // Kept characters are approximated from the previous row's text (the component reads its end state, which
      // also knows a press on clear), so after a clear this can only miss an overrun, never invent one.
      const tk = comp.meta.typing;
      if (tk && !r.bad && r.props.typeAt >= 0) {
        const text = String(r.props[tk] ?? ''), prev = rows[i - 1];
        const before = prev?.comp === comp && prev.props ? String(prev.props[tk] ?? '') : '';
        const n = text.length - (before && text.startsWith(before) ? before.length : 0);
        const next = states[i + 1] ?? (END != null ? { at: END } : null);
        const last = num(row.at + r.props.typeAt + (n - 1) * r.props.perChar);
        if (n > 0 && next && last >= next.at)
          errors.push(`${row.use} at beat ${B(row)} types "${text}" until beat ${last} but the next row starts at beat ${B(next)}; end typing before beat ${B(next)} (typeAt or perChar)`);
      }
      // A keyed list with the same key twice (meta.unique): its hotspot family finds the first only.
      if (!r.bad) for (const [listKey, field] of Object.entries(comp.meta.unique ?? {})) {
        const list = r.props[listKey];
        if (!Array.isArray(list)) continue;
        const keys = list.map((x) => (field === true ? x : x?.[field])).filter((k) => typeof k === 'string');
        const dup = [...new Set(keys.filter((k, j) => keys.indexOf(k) !== j))];
        if (dup.length) {
          r.dups = [...(r.dups ?? []), ...dup];
          warnings.push(`${row.use} at beat ${B(row)} has duplicate ${field === true ? listKey : `${field}s`} (${dup.map((d) => `"${d}"`).join(', ')}); the cursor and hover can only reach the first`);
        }
      }
      // A selection prop naming a value its list does not have (meta.choices: { active: 'items' }).
      if (strict && !r.bad) for (const [k, listKey] of Object.entries(comp.meta.choices ?? {})) {
        const list = r.props[listKey], v = r.props[k];
        if (!Array.isArray(list)) continue;
        for (const x of [v].flat()) if (typeof x === 'string' && x && !list.includes(x)) {
          const s = didYouMean(x, list);
          warnings.push(`${k} "${x}" of ${row.use} at beat ${B(row)} is not one of its ${listKey} (${list.join(', ')})${s ? `: did you mean "${s}"?` : ''}`);
        }
      }
    } else if (row.name) {
      if (!['w', 'h', 'r'].every((k) => Object.hasOwn(row, k))) errors.push(`custom row at beat ${B(row)} needs numeric w, h and r`);
    } else {
      errors.push(`row at beat ${B(row)} needs \`use\` (a component) or \`name\` (a custom state)`);
    }
    if ('shake' in row && typeof row.shake !== 'boolean') errors.push(`shake at beat ${B(row)} should be true or false`);
    if ('badge' in row && !(typeof row.badge === 'number' && Number.isFinite(row.badge) && row.badge >= 0)) errors.push(`badge at beat ${B(row)} should be a number >= 0 (0 hides it)`);
  });
  if (loop && END != null && states.length > 1) {
    const last = states.at(-1);
    if (last.at > END - 2) errors.push(`the last row (beat ${B(last)}) must sit at least 2 beats before the end (beat ${END}) so the loop settles`);
    if (!same(last, states[0], registry)) errors.push('the last row must repeat the first (same component and props) so the loop is seamless');
  }
  const unknown = (r) => r.row.use && !r.comp;
  if (!Array.isArray(cursor) || !cursor.length) errors.push('cursor() must return at least one row');
  else {
    if (cursor[0].at !== 0) errors.push('the first cursor row must be at beat 0');
    // Strict: the pointer settles in 0.8 beat. The engine speeds a move into a drag's 'down' or 'up' up so it lands
    // (at most 4x), but a move that starts under half a beat before the press still snaps or presses short. The
    // move is the latest cursor row up to i that changes position; none (the cursor rests from row 0) is fine.
    const SHORT = 0.5;
    const rushed = (i) => {
      let j = i;
      while (j > 0 && spot(cursor[j]) === spot(cursor[j - 1])) j--;
      const gap = cursor[i].at - cursor[j].at;
      return j > 0 && gap < SHORT ? Math.round(gap * 100) / 100 : null;
    };
    let open = null, openAt = null, openRow = -1, openIdx = -1, openDrag = false;
    cursor.forEach((c, i) => {
      if (i && c.at < cursor[i - 1].at) errors.push(`cursor rows must be in ascending beat order (beat ${B(c)})`);
      for (const k of Object.keys(c)) if (!CURSOR_KEYS.has(k)) errors.push(`unknown cursor key "${k}" at beat ${B(c)} (keys: ${[...CURSOR_KEYS].join(', ')})`);
      if (!c.target && !(Number.isFinite(c.x) && Number.isFinite(c.y))) errors.push(`cursor row at beat ${B(c)} needs target or x and y`);
      if (c.target !== undefined && typeof c.target !== 'string') errors.push(`cursor target at beat ${B(c)} should be a hotspot name (a string), got ${describe(c.target)}`);
      for (const k of ['dx', 'dy']) if (c[k] !== undefined && !Number.isFinite(c[k])) errors.push(`${k} at beat ${B(c)} should be a number, got ${describe(c[k])}`);
      if (c.press !== undefined && ![true, 'down', 'up'].includes(c.press)) errors.push(`press at beat ${B(c)} should be true, 'down' or 'up'`);
      if (c.sound !== undefined && c.sound !== 'key') errors.push(`sound at beat ${B(c)} should be 'key'`);
      if (c.hide !== undefined && typeof c.hide !== 'boolean') errors.push(`hide at beat ${B(c)} should be true or false, got ${describe(c.hide)}`);
      // A hidden cursor only travels: it cannot click, nor start or end a drag.
      if (c.hide === true && c.press !== undefined) errors.push(`cursor() row ${i + 1}: a hidden cursor cannot press (remove hide or press)`);
      if (c.press === 'down') { if (open !== null) errors.push(`press 'down' at beat ${openAt} has no matching 'up'`); open = c.at; openAt = B(c); openIdx = i; openRow = rows.indexOf(pressRow(rows, c)); openDrag = isDrag(rows, c);
        const g = strict && openDrag ? rushed(i) : null;
        if (g !== null) warnings.push(`cursor() row ${i + 1}: the cursor has only ${g} beat to reach '${c.target ?? `${c.x}, ${c.y}`}' before the drag starts; give it about 0.8 beat`);
      }
      if (c.press === 'up') {
        if (open === null) errors.push(`press 'up' at beat ${B(c)} has no 'down' before it`);
        else {
          // The later of the two rows starts at the change the drag crosses (a look-ahead
          // 'down' can sit on a later row than an untargeted 'up').
          const upRow = rows.indexOf(pressRow(rows, c));
          if (upRow !== openRow) errors.push(`drag from beat ${openAt} to ${B(c)} crosses a state change at beat ${B(rows[Math.max(openRow, upRow)].row)}; keep drags inside one row`);
          // Only a press on a drag hotspot (meta.drag) is a drag; a held button press stays silent.
          // A cursor row starts moving at its own beat, so the 'up' row's move lands after the release:
          // the drag itself needs a moving row strictly between the two presses.
          if (openDrag && !cursor.slice(openIdx + 1, i).some((m) => spot(m) !== spot(cursor[openIdx])))
            warnings.push(`drag from beat ${openAt} to ${B(c)} never moves: add a cursor row between the press 'down' and the 'up' that moves the cursor (the 'up' row's own move starts only after the release)`);
          if (openDrag && spot(c) !== spot(cursor[i - 1]))
            warnings.push(`press 'up' at beat ${B(c)} also moves the cursor, but that move starts only after the release; give the 'up' row the same position as the row before it`);
          else if (strict && openDrag && rushed(i) !== null)
            warnings.push(`cursor() row ${i + 1}: the cursor has only ${rushed(i)} beat to reach its release point before the drag ends; give it about 0.8 beat`);
        }
        open = null;
      }
      if (c.press === true && open !== null) errors.push(`press 'down' at beat ${openAt} has no matching 'up'`);
      // A click gets the same 0.8 beat to settle as a drag: a shorter approach clicks short of its target.
      if (strict && c.press === true) {
        const g = rushed(i);
        if (g !== null) warnings.push(`cursor() row ${i + 1}: the cursor has only ${g} beat to reach '${c.target ?? `${c.x}, ${c.y}`}' before the click; give it about 0.8 beat`);
      }
      if (typeof c.target !== 'string') return;
      const cands = candidates(rows, c.at);
      const hit = targetRow(rows, c);
      // A target naming a duplicated key resolves, but on the first of the duplicates only.
      const d = hit?.dups?.find((k) => hit.comp.meta.hotspots.some((h) => h.includes(':<') && c.target === h.slice(0, h.indexOf(':<') + 1) + k));
      if (d !== undefined) errors.push(`cursor target "${c.target}" at beat ${B(c)} names a duplicate label of ${hit.row.use}; it reaches the first "${d}" only`);
      // An unknown component is already reported above; a hotspot error on it would only mislead.
      if (cands.some(unknown) || hit) return;
      const named = cands.filter((r) => r.comp && matchHotspot(r.comp.meta.hotspots, c.target));
      const where = (r) => (r === cands[0] ? `at beat ${B(c)}` : `starting at beat ${B(r.row)}`);
      if (named.length) {
        // The name is right, but these props have no such hotspot: list what the row really has.
        errors.push(`hotspot "${c.target}" at beat ${B(c)} does not resolve on ` + named.map((r) => {
          const have = resolvable(r), s = didYouMean(c.target, have);
          return `${r.row.use} ${where(r)} (it has: ${have.length ? listNames(have) : 'nothing to aim at with these props'})${s ? `: did you mean "${s}"?` : ''}`;
        }).join(' or on '));
      } else if (!cands.some((r) => r.comp)) errors.push(`cursor target "${c.target}" at beat ${B(c)} points at a custom row, which has no hotspots; use x and y`);
      else errors.push(`hotspot "${c.target}" is not on ` + cands.map((r) => {
        return r.comp ? `${r.row.use} ${where(r)} (hotspots: ${r.comp.meta.hotspots.join(', ')})` : `the custom row ${where(r)} (no hotspots)`;
      }).join(' or on '));
    });
    if (open !== null) errors.push(`press 'down' at beat ${openAt} has no matching 'up'`);
    if (loop && cursor.length > 1 && !same(shown(cursor.at(-1)), shown(cursor[0]))) errors.push('the last cursor row must repeat the first so the loop is seamless');
  }
  if (strict && song?.rules) {
    const hold = song.rules.min_hold_beats ?? 1;
    states.forEach((row, i) => {
      const next = states[i + 1]?.at ?? END;
      const held = num(next - row.at);
      if (next != null && next - row.at < hold) errors.push(`row at beat ${B(row)} (${row.use ?? row.name}) holds ${held} beat${held === 1 ? '' : 's'}; min_hold_beats is ${hold}`);
    });
    if (song.rules.max_states && states.length - 1 > song.rules.max_states) warnings.push(`${states.length - 1} states exceeds the song's max_states (${song.rules.max_states})`);
    if (END != null) {
      // A row placed by a marker sits where the ear put it, which can be a hair before the beat it sounds on: it
      // also counts for the nearest whole beat when within 1/8 beat of it.
      const busy = new Set([...states, ...(cursor ?? [])].flatMap((r) => {
        const near = Math.round(r.at);
        return r.marker && Math.abs(r.at - near) <= 0.125 ? [Math.floor(r.at), near] : [Math.floor(r.at)];
      }));
      // In a loop, beats after the last row starts settle into the seam, so they are quiet by design.
      const last = loop ? Math.min(END - 1, Math.floor(states.at(-1).at)) : END - 1;
      const quiet = []; for (let b = 0; b <= last; b++) if (!busy.has(b)) quiet.push(b);
      if (quiet.length) warnings.push(`quiet beats (nothing starts on them): ${quiet.join(', ')}; make sure a component animates there`);
    }
  }
  return done();
}
