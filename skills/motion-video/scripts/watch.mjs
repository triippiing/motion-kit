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
// The page holds the audio (clip.wav) and the playhead; only its iframe of /index.html reloads, so playback carries
// on through a save. --brief serves index.html with the brief's tables spliced in (as check_brief's frame check
// does), so the same page works while planning; without it, index.html as is.
// Watches index.html, MOTION-BRIEF.md, song.json, theme.json, theme.css, project.json and components/ (recursive);
// changes within debounceMs (200) are one. On a change the tables that will be served must run (tables.mjs
// runTables): if they do not, the page keeps the last good version and gets `error`; else the version goes up and
// the page reloads. Then, when MOTION-BRIEF.md exists, checkBrief runs (frame check included; one at a time, a
// change during a check queues one more) and its lines print as check_brief's CLI prints them.
// Nothing is written to the project.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { serve, inside, TYPES, UsageError } from './render.mjs';
import { briefCode, pageCode, runTables, TablesError } from './tables.mjs';
import { checkBrief, projectLoop } from './check_brief.mjs';
import { isMain } from './is_main.mjs';

const PAGE_DIR = path.join(import.meta.dirname, 'watch-page');
const WATCHED = new Set(['index.html', 'MOTION-BRIEF.md', 'song.json', 'theme.json', 'theme.css', 'project.json']);
const USAGE = 'usage: watch.mjs DIR [--brief] [--port N] [--no-open]';

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

// Serves DIR with the watch routes on 127.0.0.1 and watches it. Resolves { url, close(), status() }.
// `quiet` stops the check_brief lines printing (tests).
export async function startWatch(dir, { port = 0, brief = false, debounceMs = 200, quiet = false } = {}) {
  const root = path.resolve(dir);
  for (const f of ['song.json', 'index.html']) {
    if (!existsSync(path.join(root, f))) throw new UsageError(`${root} is not a motion-video project (no ${f}); make one with new_project.sh`);
  }
  if (brief && !existsSync(path.join(root, 'MOTION-BRIEF.md'))) throw new UsageError(`--brief: ${root} has no MOTION-BRIEF.md`);
  const log = quiet ? () => {} : (s) => console.log(s);
  const logErr = quiet ? () => {} : (s) => console.error(s);

  let version = 1, tablesError = null, briefResult = null, at = new Date().toISOString();
  // --brief serves the last brief tables that ran, so a manual reload during a broken edit still shows a good page.
  let served = null;
  const status = () => {
    const errors = tablesError ? [tablesError] : briefResult?.errors ?? [];
    const warnings = tablesError ? [] : briefResult?.warnings ?? [];
    return { ok: errors.length === 0, errors, warnings, at, version, brief: existsSync(path.join(root, 'MOTION-BRIEF.md')) };
  };

  const clients = new Set();
  const push = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  };
  const pushStatus = () => { at = new Date().toISOString(); push('status', status()); };

  // The tables code that will be served (the brief's with --brief, else index.html's), checked by running it.
  // Resolves null when it runs (or there is nothing to run: a page without table markers), else the message.
  const tablesProblem = () => {
    let beats = 0;
    try { beats = JSON.parse(read(root, 'song.json')).beats.length ?? 0; } catch {}
    const md = brief ? read(root, 'MOTION-BRIEF.md') : null, html = brief ? null : read(root, 'index.html');
    const code = brief ? (md == null ? null : briefCode(md)) : (html == null ? null : pageCode(html));
    if (code == null) return brief ? 'MOTION-BRIEF.md is missing' : null;
    try { runTables(code, beats); } catch (e) {
      if (!(e instanceof TablesError)) throw e;
      return e.message;
    }
    if (brief) served = code;
    return null;
  };

  // check_brief, one run at a time: a request during a run queues one more after it.
  let checking = null, again = false, closed = false;
  const requestCheck = () => {
    if (closed) return;
    if (checking) { again = true; return; }
    checking = (async () => {
      do {
        again = false;
        if (!existsSync(path.join(root, 'MOTION-BRIEF.md'))) { briefResult = null; break; }
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

  let last = snapshot(root);
  const changed = () => {
    if (closed) return;
    const now = snapshot(root);
    if (now === last) return;
    last = now;
    tablesError = tablesProblem();
    if (tablesError) {
      logErr(`error: ${tablesError}`);
      push('error', { message: tablesError });
      pushStatus();
      return;
    }
    version++;
    push('reload', { version });
    pushStatus();
    log(`reloaded (version ${version})`);
    requestCheck();
  };

  let timer = null;
  const onEvent = (name) => {
    if (name != null && !WATCHED.has(String(name))) return;
    clearTimeout(timer);
    timer = setTimeout(changed, debounceMs);
  };
  const watchers = [watch(root, (_, name) => onEvent(name))];
  const comp = path.join(root, 'components');
  if (existsSync(comp)) watchers.push(watch(comp, { recursive: true }, () => onEvent(null)));

  tablesError = tablesProblem();
  if (tablesError) logErr(`error: ${tablesError}`);
  else requestCheck();

  const events = (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`retry: 1000\nevent: status\ndata: ${JSON.stringify(status())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  };
  const statusRoute = (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(status()));
  };
  const routes = { 'GET /__watch': servePage, 'GET /__watch/': servePage, 'GET /__watch/events': events, 'GET /__watch/status': statusRoute };
  const { server } = await serve(root, port, { routes, tables: brief ? () => served : undefined });
  return {
    url: `http://127.0.0.1:${server.address().port}/__watch`,
    status,
    close: async () => {
      closed = true;
      clearTimeout(timer);
      for (const w of watchers) w.close();
      for (const res of clients) res.end();
      clients.clear();
      await new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
      // a check still running (its frame check has Chromium open) finishes before close resolves
      await checking;
    },
  };
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
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.on(sig, () => { w.close().finally(() => process.exit(code)); });
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
