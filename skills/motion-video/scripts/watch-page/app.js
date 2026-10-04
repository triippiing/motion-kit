// app.js -- the watch page (served by watch.mjs at /__watch). Plays clip.wav in an <audio> element here and drives
// the project's own index.html (in the iframe, #frame) with seek(t) from its clock, every animation frame. A `reload`
// from /__watch/events loads the new version into a second, unseen iframe: the audio keeps playing, and once its
// `ready` resolves and a seek to the playhead runs, it swaps in for the old one. If it fails instead (ready rejects,
// a page error, no seek/ready) the old frame stays, and the error shows in the panel and is POSTed to
// /__watch/page-error so the terminal and the status have it. An `error` (tables held back) keeps the last good page.
// While --brief has no tables yet (index.html is a 503) the frame waits. The panel (bottom right) shows the
// server's status (check_brief's result, or the tables error) and the page's own errors: errors red, warnings amber,
// OK green; a click collapses or expands it; it collapses to a dot when all is clean.
// window.watchState = { version, shown, t, ok, frameReady, waiting, lastSeek, playing } (tests read it); shown is
// the version on screen.
const $ = (s) => document.querySelector(s);
const audio = $('#audio'), panel = $('#panel'), overlay = $('#overlay');
let frame = $('#frame');
// set once: a test can tell the audio element was never replaced
audio.dataset.id = Math.random().toString(36).slice(2);

const W = window.watchState = { version: 0, shown: 0, t: 0, ok: true, frameReady: false, waiting: false, lastSeek: null, playing: false };
let D = 0, songKey = null, fwin = null, gen = 0, stage = { width: 1440, height: 1440 };
let status = null, pageError = null, collapsed = false, toggled = false, wasClean = null;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// The loop length from song.json. A song that changed (another loop window, a swap) has a new clip.wav too: the
// audio reloads it, playing on if it was.
async function loadSong() {
  const r = await fetch('/song.json', { cache: 'no-store' });
  if (!r.ok) throw new Error(`could not load song.json (HTTP ${r.status})`);
  const song = await r.json();
  D = song.loop?.duration_sec ?? 0;
  const key = JSON.stringify([song.loop, song.beats?.length, song.sync]);
  if (songKey != null && key !== songKey) {
    const playing = !audio.paused;
    audio.src = `/clip.wav?v=${Date.now()}`;
    if (playing) audio.play().catch(() => {});
  }
  songKey = key;
}

// The page's own error: shown in the panel and sent to the server (status, terminal) for the version it is about.
function pageFailed(message) {
  pageError = message; renderPanel();
  fetch('/__watch/page-error', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: W.version, message }) }).catch(() => {});
}
const why = (e) => e?.message ?? e?.reason?.message ?? e?.reason ?? e?.error?.message ?? String(e);

// Loads the current version into a new, unseen iframe and swaps it in for #frame once it is ready and has seeked to
// the playhead; on a failure the frame showing stays. A newer load supersedes an older one still waiting.
async function loadFrame() {
  const my = ++gen, version = W.version;
  // --brief with no tables yet: index.html is a 503 and the preview waits (the status says why)
  const head = await fetch(`/index.html?v=${version}`, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
  if (my !== gen) return;
  W.waiting = head?.status === 503;
  if (W.waiting) { renderPanel(); return; }
  const next = document.createElement('iframe');
  Object.assign(next, { className: 'spare', title: frame.title, tabIndex: -1 });
  next.setAttribute('scrolling', 'no');
  next.setAttribute('aria-hidden', 'true');
  const loaded = new Promise((resolve) => next.addEventListener('load', resolve, { once: true }));
  next.src = `/index.html?v=${version}`;
  frame.after(next);
  fitFrame();
  await loaded;
  if (my !== gen) return next.remove();
  const w = next.contentWindow;
  // errors before the swap fail the load; after it they are the showing page's own
  let failure = null;
  const onError = (e) => {
    const m = `the page failed: ${why(e)}`;
    if (fwin === w) { fwin = null; pageFailed(m); } else failure ??= m;
  };
  w.addEventListener('error', onError);
  w.addEventListener('unhandledrejection', onError);
  try {
    if (typeof w.seek !== 'function' || !w.ready) throw new Error('index.html has no seek(t) and ready (is this a motion-video project?)');
    await w.ready;
    if (my !== gen) return next.remove();
    stage = w.STAGE ?? stage;
    fitFrame();
    if (!failure) w.seek(W.t);
  } catch (e) {
    if (my !== gen) return next.remove();
    failure ??= `the page failed: ${why(e)}`;
  }
  if (failure) {
    next.remove();
    pageFailed(W.shown ? `${failure} (still showing version ${W.shown})` : failure);
    return;
  }
  frame.remove();
  next.className = ''; next.id = 'frame'; next.removeAttribute('aria-hidden');
  frame = next;
  pageError = null;
  fwin = w; W.lastSeek = W.t; W.shown = version; W.frameReady = true;
  renderPanel();
}

const reload = () => loadSong().then(loadFrame).catch((e) => pageFailed(e.message));

function fitFrame() {
  const box = $('#frame-box').getBoundingClientRect(), s = Math.min(box.width / stage.width, box.height / stage.height);
  for (const f of document.querySelectorAll('#frame-box iframe')) Object.assign(f.style, { width: `${stage.width}px`, height: `${stage.height}px`,
    left: `${(box.width - stage.width * s) / 2}px`, top: `${(box.height - stage.height * s) / 2}px`, transform: `scale(${s})` });
}
new ResizeObserver(fitFrame).observe($('#frame-box'));

function renderPanel() {
  // the server's status carries the page's error back too: once is enough
  const errors = [...new Set([...(pageError ? [pageError] : []), ...(status?.errors ?? [])])];
  const warnings = status?.warnings ?? [];
  const clean = !errors.length && !warnings.length;
  // collapsed when clean, open when not; a click overrides that until the panel's state next changes
  if (clean !== wasClean) { toggled = false; wasClean = clean; }
  if (!toggled) collapsed = clean;
  W.ok = !errors.length;
  panel.className = `${errors.length ? 'bad' : warnings.length ? 'warn' : 'good'}${collapsed ? ' collapsed' : ''}`;
  $('#lines').innerHTML = [
    ...errors.map((e) => `<li class="error">error: ${esc(e)}</li>`),
    ...warnings.map((w) => `<li class="warning">warning: ${esc(w)}</li>`),
    ...(errors.length ? [] : [`<li class="ok">${status?.brief ? 'brief OK' : 'no errors'}</li>`]),
  ].join('');
}
panel.addEventListener('click', () => {
  if (getSelection().toString()) return; // selecting a message to copy is not a toggle
  toggled = true; collapsed = !collapsed; renderPanel();
});

function play() { audio.play().then(() => { overlay.hidden = true; }).catch((e) => { pageError = `could not play clip.wav: ${e.message}`; renderPanel(); }); }
overlay.addEventListener('click', play);
addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  e.preventDefault();
  if (audio.paused) play(); else { audio.pause(); overlay.hidden = false; }
});

const events = new EventSource('/__watch/events');
events.addEventListener('status', (e) => {
  status = JSON.parse(e.data);
  renderPanel();
  // the first status names the version to load (so a page error reports the version the server knows)
  if (!W.version) { W.version = status.version; reload(); }
});
events.addEventListener('reload', (e) => { W.version = JSON.parse(e.data).version; reload(); });
events.addEventListener('error', (e) => {
  // the server's `error` event carries data; a dropped connection (also 'error') has none and reconnects by itself
  if (!e.data) return;
  status = { ...(status ?? {}), ok: false, errors: JSON.parse(e.data).message.split('\n'), warnings: [] };
  renderPanel();
});

function tick() {
  requestAnimationFrame(tick);
  W.playing = !audio.paused;
  if (D > 0) W.t = audio.currentTime % D;
  if (fwin && W.t !== W.lastSeek) {
    try { fwin.seek(W.t); W.lastSeek = W.t; } catch (e) {
      fwin = null; pageFailed(`the animation failed at ${W.t.toFixed(3)} s: ${e.message}`);
    }
  }
}

renderPanel();
requestAnimationFrame(tick);
