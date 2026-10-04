// app.js -- the watch page (served by watch.mjs at /__watch). Plays clip.wav in an <audio> element here and drives
// the project's own index.html (in the iframe) with seek(t) from its clock, every animation frame. A `reload` from
// /__watch/events reloads only the iframe: the audio keeps playing, and the new page is seeked to the current
// playhead once its `ready` resolves. An `error` (tables that do not run) keeps the last good page. The panel
// (bottom right) shows the server's status (check_brief's result, or the tables error) and the page's own errors:
// errors red, warnings amber, OK green; a click collapses or expands it; it collapses to a dot when all is clean.
// window.watchState = { version, t, ok, frameReady, lastSeek, playing } (tests read it).
const $ = (s) => document.querySelector(s);
const audio = $('#audio'), frame = $('#frame'), panel = $('#panel'), overlay = $('#overlay');
// set once: a test can tell the audio element was never replaced
audio.dataset.id = Math.random().toString(36).slice(2);

const W = window.watchState = { version: 0, t: 0, ok: true, frameReady: false, lastSeek: null, playing: false };
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

// Loads (or reloads) the iframe; a newer load supersedes an older one still waiting.
async function loadFrame() {
  const my = ++gen;
  fwin = null; W.frameReady = false;
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  frame.src = `/index.html?v=${W.version}`;
  await loaded;
  if (my !== gen) return;
  const w = frame.contentWindow;
  if (typeof w.seek !== 'function' || !w.ready) throw new Error('index.html has no seek(t) and ready (is this a motion-video project?)');
  const fail = (e) => { pageError = `the page failed: ${e.message ?? e.reason?.message ?? e.reason ?? e}`; renderPanel(); };
  w.addEventListener('error', fail);
  w.addEventListener('unhandledrejection', fail);
  await w.ready;
  if (my !== gen) return;
  stage = w.STAGE ?? stage;
  pageError = null;
  fwin = w; W.lastSeek = null; W.frameReady = true;
  fitFrame();
  renderPanel();
}

const reload = () => loadSong().then(loadFrame).catch((e) => { pageError = e.message; renderPanel(); });

function fitFrame() {
  const box = $('#frame-box').getBoundingClientRect(), s = Math.min(box.width / stage.width, box.height / stage.height);
  Object.assign(frame.style, { width: `${stage.width}px`, height: `${stage.height}px`,
    left: `${(box.width - stage.width * s) / 2}px`, top: `${(box.height - stage.height * s) / 2}px`, transform: `scale(${s})` });
}
new ResizeObserver(fitFrame).observe($('#frame-box'));

function renderPanel() {
  const errors = [...(pageError ? [pageError] : []), ...(status?.errors ?? [])];
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
  if (!W.version) W.version = status.version;
  renderPanel();
});
events.addEventListener('reload', (e) => { W.version = JSON.parse(e.data).version; reload(); });
events.addEventListener('error', (e) => {
  // the server's `error` event carries data; a dropped connection (also 'error') has none and reconnects by itself
  if (!e.data) return;
  status = { ...(status ?? {}), ok: false, errors: [JSON.parse(e.data).message], warnings: [] };
  renderPanel();
});

function tick() {
  requestAnimationFrame(tick);
  W.playing = !audio.paused;
  if (D > 0) W.t = audio.currentTime % D;
  if (fwin && W.t !== W.lastSeek) {
    try { fwin.seek(W.t); W.lastSeek = W.t; } catch (e) {
      pageError = `the animation failed at ${W.t.toFixed(3)} s: ${e.message}`; fwin = null; renderPanel();
    }
  }
}

renderPanel();
reload();
requestAnimationFrame(tick);
