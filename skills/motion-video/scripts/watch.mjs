#!/usr/bin/env node
// watch.mjs -- a live preview: the project plays in a page that reloads its animation on every save, keeps playing,
// and shows check_brief's result.
//
//   node watch.mjs DIR [--brief] [--port N] [--no-open]
//
// Serves DIR on 127.0.0.1 (render.mjs serve) with these routes added:
//   GET /__watch          the page (scripts/watch-page/index.html, app.js, style.css; its files are under /__watch/)
//   GET /__watch/events   Server-Sent Events: `reload` {version}, `status` (as below), `error` {message}
//   GET /__watch/status   {ok, errors, warnings, at, version, brief}
//   POST /__watch/page-error  {version, message}: the page's own error loading that version (it keeps showing the
//                         last good frame); it joins the status errors until the next reload, and prints.
// The page holds the audio (clip.wav) and the playhead; only its iframe of /index.html reloads, so playback carries
// on through a save. --brief serves index.html with the brief's tables spliced in (as check_brief's frame check
// does), so the same page works while planning; until the brief's tables have once passed, index.html is a 503
// (the preview waits); without --brief, index.html as is.
// Watches index.html, MOTION-BRIEF.md, song.json, theme.json, theme.css, project.json and components/ (recursive);
// changes within debounceMs (200) are one. On a change the tables that will be served must run (tables.mjs
// runTables) and pass the engine's validator (non-strict, as the page's own createScene runs it): if not, the
// version stays, the page keeps the last good version and gets `error`; else the version goes up and the page
// reloads. Then, when MOTION-BRIEF.md exists, checkBrief runs (frame check included; one at a time, a change during
// a check queues one more) and its lines print as check_brief's CLI prints them. A watcher that fails (fs.watch
// 'error') prints `error: ...` and the watch closes.
// Nothing is written to the project.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { serve, inside, TYPES, UsageError } from './render.mjs';
import { briefCode, pageCode, runTables, TablesError } from './tables.mjs';
import { checkBrief, loadRegistry, projectLoop, projectTheme } from './check_brief.mjs';
import { validate } from '../components/core/validate.js';
import { isMain } from './is_main.mjs';

const PAGE_DIR = path.join(import.meta.dirname, 'watch-page');
const WATCHED = new Set(['index.html', 'MOTION-BRIEF.md', 'song.json', 'theme.json', 'theme.css', 'project.json']);
const USAGE = 'usage: watch.mjs DIR [--brief] [--port N] [--no-open]';
const MAX_BODY = 16 * 1024;
const WAITING = "nothing to preview until the brief's tables pass: index.html is not served";

const read = (root, f) => { try { return readFileSync(path.join(root, f), 'utf8'); } catch { return null; } };

// What the watched files hold now: their contents, and components/' paths, sizes and mtimes. A change event that
// leaves this as it was (a late duplicate from fs.watch, a touch) is not a change.
function snapshot(root) {
  const h = createHash('sha256');
  for (const f of WATCHED) h.update(`${f}\0${read(root, f) ?? '\u0001missing'}\0`);
  const comp = path.join(root, 'components');
  let files = [];
  try { files = readdirSync(comp, { recursive: true }).map(String).sort(); } catch {}
  for (const f of files) {
    try { const s = statSync(path.join(comp, f)); h.update(`${f}\0${s.size}\0${s.mtimeMs}\0`); } catch {}
  }
  return h.digest('hex');
}

// Serves DIR with the watch routes on 127.0.0.1 and watches it. Resolves { url, close(), status(), closed }; closed
// resolves once it has closed (close(), or a watcher error). `quiet` stops the lines printing (tests); `fsWatch`
// stands in for fs.watch (tests).
export async function startWatch(dir, { port = 0, brief = false, debounceMs = 200, quiet = false, fsWatch = watch } = {}) {
  const root = path.resolve(dir);
  for (const f of ['song.json', 'index.html']) {
    if (!existsSync(path.join(root, f))) throw new UsageError(`${root} is not a motion-video project (no ${f}); make one with new_project.sh`);
  }
  if (brief && !existsSync(path.join(root, 'MOTION-BRIEF.md'))) throw new UsageError(`--brief: ${root} has no MOTION-BRIEF.md`);
  const log = quiet ? () => {} : (s) => console.log(s);
  const logErr = quiet ? () => {} : (s) => console.error(s);

  // tablesErrors: why the tables on disk are held back ([] when they passed); pageError: the page's own error
  // loading the current version (POST /__watch/page-error), cleared by the next reload.
  let version = 1, tablesErrors = [], pageError = null, briefResult = null, at = new Date().toISOString();
  // --brief serves the last brief tables that passed, so a manual reload during a broken edit still shows a good page.
  let served = null;
  const status = () => {
    const held = [...tablesErrors, ...(brief && served == null ? [WAITING] : [])];
    const errors = held.length ? held : [...(pageError ? [pageError] : []), ...(briefResult?.errors ?? [])];
    const warnings = held.length ? [] : briefResult?.warnings ?? [];
    return { ok: errors.length === 0, errors, warnings, at, version, brief: existsSync(path.join(root, 'MOTION-BRIEF.md')) };
  };

  const clients = new Set();
  const push = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  };
  const pushStatus = () => { at = new Date().toISOString(); push('status', status()); };

  // The tables code that will be served (the brief's with --brief, else index.html's), checked by running it and
  // then by the engine's validator, non-strict, with what the page itself would pass createScene (song.json, the
  // theme, project.json's loop, the project's components/ registry): an error here is one the page would throw on
  // load, blanking it. Resolves [] when they pass (or there is nothing to run: a page without table markers), else
  // the errors. Warnings do not hold a version back.
  const tablesProblem = async () => {
    let song = null;
    try { song = JSON.parse(read(root, 'song.json')); } catch {}
    const beats = Array.isArray(song?.beats) ? song.beats.length : 0;
    const md = brief ? read(root, 'MOTION-BRIEF.md') : null, html = brief ? null : read(root, 'index.html');
    const code = brief ? (md == null ? null : briefCode(md)) : (html == null ? null : pageCode(html));
    if (code == null) return brief ? ['MOTION-BRIEF.md is missing'] : [];
    let t;
    try { t = runTables(code, beats); } catch (e) {
      if (!(e instanceof TablesError)) throw e;
      return [e.message];
    }
    if (!Array.isArray(song?.beats)) return ['song.json has no beats list (is it valid JSON? re-run analyze_song.py)'];
    try {
      const { errors } = validate({ states: t.states, cursor: t.cursor, registry: await loadRegistry(root), song,
        theme: projectTheme(root), loop: projectLoop(root).loop });
      if (errors.length) return errors;
    } catch (e) { return [`the tables could not be checked: ${e.message}`]; }
    if (brief) served = code;
    return [];
  };

  // check_brief, one run at a time: a request during a run queues one more after it.
  let checking = null, again = false, closed = false;
  const requestCheck = () => {
    if (closed) return;
    if (checking) { again = true; return; }
    checking = (async () => {
      do {
        again = false;
        if (!existsSync(path.join(root, 'MOTION-BRIEF.md'))) { briefResult = null; pushStatus(); break; }
        let r;
        try { r = await checkBrief(root, { loop: projectLoop(root).loop }); } catch (e) { r = { errors: [e.message], warnings: [] }; }
        if (closed) return;
        briefResult = r;
        for (const w of r.warnings) log(`warning: ${w}`);
        for (const e of r.errors) logErr(`error: ${e}`);
        log(r.errors.length ? `brief has ${r.errors.length} error(s)` : 'brief OK');
        pushStatus();
      } while (again && !closed);
    })().finally(() => { checking = null; });
  };

  // A change, one at a time (the check awaits the registry): one during a run queues one more after it.
  let last = snapshot(root), changing = null, changeAgain = false;
  const changeOnce = async () => {
    const now = snapshot(root);
    if (now === last) return;
    last = now;
    tablesErrors = await tablesProblem();
    if (closed) return;
    if (tablesErrors.length) {
      for (const e of tablesErrors) logErr(`error: ${e}`);
      push('error', { message: tablesErrors.join('\n') });
      pushStatus();
      return;
    }
    version++; pageError = null;
    push('reload', { version });
    pushStatus();
    log(`reloaded (version ${version})`);
    requestCheck();
  };
  const changed = () => {
    if (closed) return;
    if (changing) { changeAgain = true; return; }
    changing = (async () => {
      do { changeAgain = false; await changeOnce(); } while (changeAgain && !closed);
    })().finally(() => { changing = null; });
  };

  let timer = null;
  const onEvent = (name) => {
    if (name != null && !WATCHED.has(String(name))) return;
    clearTimeout(timer);
    timer = setTimeout(changed, debounceMs);
  };
  tablesErrors = await tablesProblem();
  for (const e of tablesErrors) logErr(`error: ${e}`);
  if (brief && served == null) logErr(`error: ${WAITING}`);
  if (!tablesErrors.length) requestCheck();

  const events = (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`retry: 1000\nevent: status\ndata: ${JSON.stringify(status())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  };
  const statusRoute = (req, res) => sendJson(res, 200, status());
  // The page's own error for a version (JSON only, small; a stale version is ignored).
  const pageErrorRoute = async (req, res) => {
    if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) { req.resume(); return sendJson(res, 415, { error: 'send application/json' }); }
    const text = await readBody(req);
    if (text == null) return sendJson(res, 413, { error: `the body is over ${MAX_BODY} bytes` }, { connection: 'close' });
    let body = null;
    try { body = JSON.parse(text); } catch {}
    if (typeof body?.message !== 'string' || !Number.isInteger(body.version)) return sendJson(res, 400, { error: 'the body must be {"version": N, "message": "..."}' });
    if (body.version === version && !closed) {
      pageError = body.message.slice(0, 2000);
      logErr(`error: ${pageError}`);
      pushStatus();
    }
    sendJson(res, 200, {});
  };
  const routes = { 'GET /__watch': servePage, 'GET /__watch/': servePage, 'GET /__watch/events': events, 'GET /__watch/status': statusRoute,
    'POST /__watch/page-error': pageErrorRoute };
  // --brief: index.html with the last brief tables that passed; none yet is a 503, and the page waits
  const { server } = await serve(root, port, { routes, tables: brief ? () => served ?? false : undefined });

  let resolveClosed;
  const closedP = new Promise((r) => { resolveClosed = r; });
  const close = async () => {
    if (closed) return closedP;
    closed = true;
    clearTimeout(timer);
    for (const w of watchers) w.close();
    for (const res of clients) res.end();
    clients.clear();
    await new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
    // a change or check still running (a frame check has Chromium open) finishes before close resolves
    await changing; await checking;
    resolveClosed();
  };
  // A watcher that fails (the directory went away, too many open files) ends the watch: printed, never thrown.
  const watchers = [];
  const onWatchError = (e) => { logErr(`error: watching ${root} failed: ${e.message}`); close(); };
  try {
    watchers.push(fsWatch(root, (_, name) => onEvent(name)));
    const comp = path.join(root, 'components');
    if (existsSync(comp)) watchers.push(fsWatch(comp, { recursive: true }, () => onEvent(null)));
  } catch (e) { await close(); throw e; }
  for (const w of watchers) w.on('error', onWatchError);
  return { url: `http://127.0.0.1:${server.address().port}/__watch`, status, close, closed: closedP };
}

function sendJson(res, code, value, headers = {}) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

// The body as text, or null once it passes MAX_BODY (the rest is drained, not kept); resolves when the body ends.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); });
    req.on('end', () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function servePage(req, res) {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).slice('/__watch'.length).replace(/^\//, '');
  const file = path.join(PAGE_DIR, rel || 'index.html');
  if (!inside(PAGE_DIR, file)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}

function parseArgs(argv) {
  const o = { brief: false, noOpen: false, port: 0 }; let dir;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { dir ??= a; continue; }
    if (a === '--brief') o.brief = true;
    else if (a === '--no-open') o.noOpen = true;
    else if (a === '--port') {
      const v = argv[++i];
      if (v == null || !/^[0-9]+$/.test(v) || Number(v) > 65535) throw new UsageError(`--port must be 0 to 65535, got "${v ?? ''}"`);
      o.port = Number(v);
    } else throw new UsageError(`unknown flag ${a}`);
  }
  if (!dir) throw new UsageError(USAGE);
  return { dir, ...o };
}

async function main() {
  const { dir, port, brief, noOpen } = parseArgs(process.argv.slice(2));
  let w;
  try { w = await startWatch(dir, { port, brief }); } catch (e) {
    if (e.code === 'EADDRINUSE') throw new UsageError(`port ${port} is in use; pass another --port`);
    throw e;
  }
  console.log(`watching: ${w.url}`);
  let stopping = false;
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.on(sig, () => { stopping = true; w.close().finally(() => process.exit(code)); });
  // closed without a signal: a watcher failed (already printed)
  w.closed.then(() => { if (!stopping) process.exit(1); });
  if (!noOpen) {
    const child = spawn('open', [w.url], { detached: true, stdio: 'ignore' });
    child.on('error', () => console.log('open the URL above in a browser'));
    child.unref();
  }
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    if (e instanceof UsageError && !e.message.startsWith('usage:')) console.error(USAGE);
    process.exit(e instanceof UsageError ? 2 : 1);
  });
}
