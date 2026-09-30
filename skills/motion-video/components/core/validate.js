// validate.js -- one set of rules for runtime errors (engine) and brief checks (check_brief.mjs).
export const RESERVED = new Set(['at', 'use', 'name', 'w', 'h', 'r', 'fill', 'ink', 'shake', 'badge']);
const CURSOR_KEYS = new Set(['at', 'x', 'y', 'target', 'dx', 'dy', 'press', 'sound']);

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

// The row a cursor row aims at: the row active at its beat if it has the hotspot,
// otherwise the next row if it starts within one beat and has it (a press landing
// on the beat a state starts). rows: [{ row, comp }] in order.
export function targetRow(rows, c) {
  let k = 0;
  rows.forEach((r, i) => { if (r.row.at <= c.at + 1e-9) k = i; });
  for (const i of [k, k + 1]) {
    const r = rows[i];
    if (r && r.comp && (i === k || r.row.at - c.at <= 1 + 1e-9) && matchHotspot(r.comp.meta.hotspots, c.target)) return r;
  }
  return null;
}

const same = (a, b) => JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });

export function validate({ states, cursor, registry, song, loop = true, strict = false }) {
  const errors = [], warnings = [];
  const END = song?.beats?.length;
  if (!Array.isArray(states) || !states.length) return { errors: ['states() must return at least one row'], warnings };
  if (states[0].at !== 0) errors.push('first row must be at beat 0');
  states.forEach((row, i) => {
    if (i && !(row.at > states[i - 1].at)) errors.push(`rows must be in ascending beat order (beat ${row.at} after ${states[i - 1].at})`);
    if (row.use) {
      const comp = registry[row.use];
      if (!comp) {
        const s = didYouMean(row.use, Object.keys(registry));
        errors.push(`unknown component "${row.use}" at beat ${row.at}${s ? `: did you mean "${s}"?` : ''} (see components/CATALOG.md)`);
        return;
      }
      const props = comp.meta.props;
      for (const [k, v] of Object.entries(row)) {
        if (RESERVED.has(k)) continue;
        if (!(k in props)) { errors.push(`unknown prop "${k}" for ${row.use} (props: ${Object.keys(props).join(', ') || 'none'})`); continue; }
        if (!typeOk(props[k][0], v)) errors.push(`prop "${k}" of ${row.use} should be ${props[k][0]}, got ${JSON.stringify(v)}`);
      }
    } else if (row.name) {
      if (![row.w, row.h, row.r].every((x) => typeof x === 'number')) errors.push(`custom row at beat ${row.at} needs numeric w, h and r`);
    } else {
      errors.push(`row at beat ${row.at} needs \`use\` (a component) or \`name\` (a custom state)`);
    }
    if ('shake' in row && typeof row.shake !== 'boolean') errors.push(`shake at beat ${row.at} should be true or false`);
    if ('badge' in row && !(typeof row.badge === 'number' && row.badge >= 0)) errors.push(`badge at beat ${row.at} should be a number >= 0`);
  });
  if (loop && END != null && states.length > 1) {
    const last = states.at(-1);
    if (last.at > END - 2) errors.push(`the last row (beat ${last.at}) must sit at least 2 beats before the end (beat ${END}) so the loop settles`);
    if (!same(last, states[0])) errors.push('the last row must repeat the first (same component and props) so the loop is seamless');
  }
  const rows = states.map((row) => ({ row, comp: row.use ? registry[row.use] : null }));
  if (!Array.isArray(cursor) || !cursor.length) errors.push('cursor() must return at least one row');
  else {
    if (cursor[0].at !== 0) errors.push('the first cursor row must be at beat 0');
    let open = null;
    cursor.forEach((c, i) => {
      if (i && c.at < cursor[i - 1].at) errors.push(`cursor rows must be in ascending beat order (beat ${c.at})`);
      for (const k of Object.keys(c)) if (!CURSOR_KEYS.has(k)) errors.push(`unknown cursor key "${k}" at beat ${c.at} (keys: ${[...CURSOR_KEYS].join(', ')})`);
      if (!c.target && !(typeof c.x === 'number' && typeof c.y === 'number')) errors.push(`cursor row at beat ${c.at} needs target or x and y`);
      if (c.press !== undefined && ![true, 'down', 'up'].includes(c.press)) errors.push(`press at beat ${c.at} should be true, 'down' or 'up'`);
      if (c.sound !== undefined && c.sound !== 'key') errors.push(`sound at beat ${c.at} should be 'key'`);
      if (c.press === 'down') { if (open !== null) errors.push(`press 'down' at beat ${open} has no matching 'up'`); open = c.at; }
      if (c.press === 'up') { if (open === null) errors.push(`press 'up' at beat ${c.at} has no 'down' before it`); open = null; }
      if (c.press === true && open !== null) errors.push(`press 'down' at beat ${open} has no matching 'up'`);
      if (c.target) {
        if (!targetRow(rows, c)) {
          let k = 0; rows.forEach((r, j) => { if (r.row.at <= c.at + 1e-9) k = j; });
          const r = rows[k];
          errors.push(r.comp
            ? `hotspot "${c.target}" is not on ${r.row.use} at beat ${c.at} (hotspots: ${r.comp.meta.hotspots.join(', ')})`
            : `cursor target "${c.target}" at beat ${c.at} points at a custom row, which has no hotspots; use x and y`);
        }
      }
    });
    if (open !== null) errors.push(`press 'down' at beat ${open} has no matching 'up'`);
    if (loop && cursor.length > 1 && !same(cursor.at(-1), cursor[0])) errors.push('the last cursor row must repeat the first so the loop is seamless');
  }
  if (strict && song?.rules) {
    const hold = song.rules.min_hold_beats ?? 1;
    states.forEach((row, i) => {
      const next = states[i + 1]?.at ?? END;
      if (next != null && next - row.at < hold) errors.push(`row at beat ${row.at} (${row.use ?? row.name}) holds ${next - row.at} beat${next - row.at === 1 ? '' : 's'}; min_hold_beats is ${hold}`);
    });
    if (song.rules.max_states && states.length - 1 > song.rules.max_states) warnings.push(`${states.length - 1} states exceeds the song's max_states (${song.rules.max_states})`);
    if (END != null) {
      const busy = new Set([...states, ...(cursor ?? [])].map((r) => Math.floor(r.at)));
      const quiet = []; for (let b = 0; b < END; b++) if (!busy.has(b)) quiet.push(b);
      if (quiet.length) warnings.push(`quiet beats (nothing starts on them): ${quiet.join(', ')}; make sure a component animates there`);
    }
  }
  return { errors, warnings };
}
