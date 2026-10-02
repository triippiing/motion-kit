// app.js -- the sync page (served by sync.mjs at /__sync). Plays clip.wav on the Web Audio clock with beat clicks
// scheduled on that same clock, drives the project's own index.html (in the iframe) with seek(t) from it, and edits
// the `sync` section of song.json: nudge, tap tempo, meter, swing, markers, "Sounds right". Save posts it to
// /__sync/save, which re-runs the analyser and re-cuts clip.wav; the page then reloads the grid, the audio and the
// animation. window.syncState exposes the state (tests read it); window.syncReady is true once loaded.
//
// Timing: everything that sounds is scheduled with AudioBufferSourceNode.start(when) on the AudioContext clock. The
// song loops in one source node (loop points on the decoded buffer, exactly the loop's length in samples). Clicks
// go out from a lookahead loop: every 25 ms it schedules the clicks that fall in the next 100 ms, so the timer only
// decides when to schedule, never when a click sounds. The playhead is read from the same clock:
// t = (audible context time - startedAt) mod loop, where the audible time is getOutputTimestamp() (the context time
// the speakers are playing now), falling back to currentTime minus the reported latency. So the animation shows
// the frame you hear, and grid lines cross the playhead when their click sounds.
//
// Preview: a nudge moves beats only on Save (Save re-cuts the clip). Until then the page shifts the grid (lines,
// clicks and the animation's beats) by the pending nudge against the playing audio, with cue_t = t (a nudged grid
// is the user's, no snapping to onsets). Swing previews exactly (timing.js applies it). Tempo and meter preview an
// evenly spaced grid until Save fits the real one; the animation keeps the saved tempo meanwhile.
// timing.js is the project's own copy (what its renders use); a project copied before timing.js existed gets the
// kit's, which sync.mjs serves as /__sync/timing.js.
let beatTime, beatAt;
async function loadTiming() {
  try { ({ beatTime, beatAt } = await import('/components/core/timing.js')); } catch {
    ({ beatTime, beatAt } = await import('/__sync/timing.js'));
  }
}

const $ = (s) => document.querySelector(s);
const METERS = { '4/4': 4, '3/4': 3, '6/8': 2 };
const NAME = /^[a-z][a-z0-9-]*$/;
const TICK_MS = 25, HORIZON = 0.1, START_DELAY = 0.05;
const MIN_TAPS = 8, TAP_GAP_MS = 2000, BPM_RANGE = [40, 240];
const VIEW_BARS = [0.5, 8], RULER = 22;
const PEAK_RATE = 1000; // waveform envelope buckets per second

const mod = (x, m) => ((x % m) + m) % m;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const meterOf = (bpb) => ({ 3: '3/4', 2: '6/8' })[bpb] ?? '4/4';

const S = window.syncState = {
  song: null,           // song.json as last saved
  pending: null,        // the sync section being edited: { nudge_ms, bpm, meter, swing, markers: [{ name, t }], checked_by_ear? }
  anim: null,           // the preview song the animation gets (nudge, swing, markers)
  grid: null,           // the preview song the waveform and clicks use (also approximate tempo and meter)
  playing: false, t: 0, lastSeek: null, startedAt: 0, loopSec: 0, latency: 0,
  clicksOn: true, clickTimes: [], clicks: [],   // clickTimes: [{ beat, t, down }] (loop s); clicks: every start(when) made
  blips: [],            // every scrub blip: { when, t }
  taps: [], tapBpm: null,
  viewStart: 0, viewBars: 2, follow: true, selected: null,
  dirty: false, saving: false, saves: 0, error: null, warning: null, lastSaved: null,
  rebuilds: 0, iframeReloads: 0,
  clockT: () => clockT(),
  scheduled: () => [playWhen, scheduledUntil], // the audio-clock span the scheduler has covered since Play
};

// ---------------- the sync section: saved, pending, previews ----------------

function savedSync(song) {
  const s = song.sync && typeof song.sync === 'object' ? song.sync : {};
  return { nudge_ms: s.nudge_ms ?? 0, bpm: s.bpm ?? null, meter: s.meter ?? meterOf(song.beats_per_bar), swing: s.swing ?? 0.5,
    markers: (s.markers ?? []).map((m) => ({ name: m.name, t: m.t, ...(typeof m.note === 'string' ? { note: m.note } : {}) })), ...(s.checked_by_ear ? { checked_by_ear: s.checked_by_ear } : {}) };
}

// The two preview songs from the saved song and the pending edits.
function previews() {
  const song = S.song, p = S.pending, was = savedSync(song), D = song.loop.duration_sec;
  const d = (p.nudge_ms - was.nudge_ms) / 1000;
  const beats = d === 0 ? song.beats : song.beats.map((b) => ({ ...b, t: r6(b.t + d), cue_t: r6(b.t + d) }));
  const markers = p.markers.map((m) => {
    const t = r6(m.t - song.loop.start_sec);
    return { name: m.name, song_t: m.t, t, in_loop: t >= 0 && t < D };
  });
  const sync = { ...(song.sync ?? {}), nudge_ms: p.nudge_ms, swing: p.swing };
  const anim = { ...song, beats, markers, sync };
  let grid = anim;
  if (p.bpm !== was.bpm || p.meter !== was.meter) {
    // approximate until Save: an even grid at the new tempo from the (nudged) first beat, bars of the new meter
    const bs = 60 / (p.bpm ?? song.bpm), t0 = beats[0].t, n = Math.max(1, Math.ceil((D - t0) / bs - 1e-9));
    grid = { ...anim, beat_sec: bs, beats_per_bar: METERS[p.meter],
      beats: Array.from({ length: n }, (_, i) => ({ i, t: r6(t0 + i * bs), cue_t: r6(t0 + i * bs) })) };
  } else grid = { ...anim, beats_per_bar: METERS[p.meter] };
  return { anim, grid };
}

let animKey = null, rebuildQueued = false;
// After any edit: previews, the click list, readouts, and (coalesced to one per frame) the animation.
function refresh({ gridMoved = false } = {}) {
  const { anim, grid } = previews();
  S.anim = anim; S.grid = grid;
  const bpb = grid.beats_per_bar;
  S.clickTimes = grid.beats.map((_, i) => ({ beat: i, t: beatTime(grid, i), down: i % bpb === 0 }));
  S.dirty = JSON.stringify(S.pending) !== JSON.stringify(savedSync(S.song));
  const key = JSON.stringify([anim.beats[0].t, anim.beats[0].cue_t, anim.sync.swing, anim.markers]);
  if (key !== animKey) { animKey = key; rebuildQueued = true; }
  if (gridMoved) rescheduleClicks();
  renderControls();
}

// A change to the grid itself (nudge, tempo, meter) undoes "Sounds right": the check was of the old grid.
function gridChanged() {
  delete S.pending.checked_by_ear;
  refresh({ gridMoved: true });
}

// ---------------- audio: the clip, the song loop, the clicks ----------------

let ctx, buffer, songNode = null, songGain, clickGain, hiClick, loClick, timer = null;
let playWhen = 0, playFrom = 0, scheduledUntil = 0, queued = [];
let peaks = null; // { max: Float32Array, n } of |sample| per 1 ms bucket

function makeClick(freq) {
  const sr = ctx.sampleRate, n = Math.round(sr * 0.1), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.sin((2 * Math.PI * freq * i) / sr) * Math.exp(-i / sr / 0.02);
  return b;
}

async function loadClip() {
  const r = await fetch(`/clip.wav?v=${Date.now()}`);
  if (!r.ok) throw new Error(`could not load clip.wav (HTTP ${r.status}); run analyze_song.py for this project`);
  const decoded = await ctx.decodeAudioData(await r.arrayBuffer());
  // exactly the loop's length in samples (pad or trim), so the loop points and the playhead share one period
  const n = Math.max(1, Math.round(S.song.loop.duration_sec * ctx.sampleRate));
  const b = ctx.createBuffer(decoded.numberOfChannels, n, ctx.sampleRate);
  for (let c = 0; c < decoded.numberOfChannels; c++) b.copyToChannel(decoded.getChannelData(c).subarray(0, n), c);
  buffer = b; S.loopSec = n / ctx.sampleRate;
  const per = ctx.sampleRate / PEAK_RATE, m = Math.ceil(n / per), max = new Float32Array(m);
  const chans = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
  for (let k = 0; k < m; k++) {
    let v = 0;
    for (let i = Math.floor(k * per), e = Math.min(n, Math.floor((k + 1) * per)); i < e; i++) {
      for (const ch of chans) { const a = Math.abs(ch[i]); if (a > v) v = a; }
    }
    max[k] = v;
  }
  let top = 0; for (const v of max) if (v > top) top = v;
  peaks = { max, n: m, norm: top > 0 ? 1 / top : 1 };
  overviewImage = null;
}

// The context time the speakers are playing now.
function audibleNow() {
  const ts = ctx.getOutputTimestamp?.();
  if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
    const now = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    if (Math.abs(ctx.currentTime - now) < 0.5) return now;
  }
  return ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
}

// The playhead in loop seconds, from the audio clock while playing.
function clockT() {
  if (!S.playing) return S.t;
  const now = audibleNow();
  S.latency = ctx.currentTime - now;
  return now < playWhen ? playFrom : mod(now - S.startedAt, S.loopSec);
}

function play() {
  if (S.playing || !buffer) return;
  ctx.resume();
  const when = ctx.currentTime + START_DELAY, from = mod(S.t, S.loopSec);
  songNode = ctx.createBufferSource();
  Object.assign(songNode, { buffer, loop: true, loopStart: 0, loopEnd: buffer.duration });
  songNode.connect(songGain);
  songNode.start(when, from);
  Object.assign(S, { playing: true, startedAt: when - from, clicks: [], follow: true });
  playWhen = when; playFrom = from; scheduledUntil = when; queued = [];
  schedule();
  timer = setInterval(schedule, TICK_MS);
  renderControls();
}

function stop() {
  if (!S.playing) return;
  S.t = clockT();
  clearInterval(timer); timer = null;
  try { songNode.stop(); } catch {}
  songNode.disconnect(); songNode = null;
  cancelClicks();
  S.playing = false;
  renderControls();
}

const toggle = () => (S.playing ? stop() : play());
function seekTo(t) {
  const was = S.playing;
  if (was) stop();
  S.t = mod(t, S.loopSec);
  if (was) play();
}

// Scrubbing (arrow keys, Home): 10 ms, a quarter beat, or to the next / previous beat line, wrapping at the loop
// edges. Playing, it seeks (stop() takes back the clicks not yet sounding, play() schedules afresh, so none double
// or drop); stopped, it plays a short blip of the song at the new playhead.
function scrub(dir, step) {
  const t = clockT(), L = S.loopSec;
  if (step === 'fine') return scrubTo(t + dir * 0.010);
  if (step === 'quarter') return scrubTo(t + (dir * S.grid.beat_sec) / 4);
  const lines = S.clickTimes.map((c) => mod(c.t, L)).sort((a, b) => a - b), eps = 1e-6;
  const next = dir > 0 ? (lines.find((x) => x > t + eps) ?? lines[0] + L) : (lines.findLast((x) => x < t - eps) ?? lines.at(-1) - L);
  scrubTo(next);
}

function scrubTo(t) {
  if (S.playing) return seekTo(t);
  S.t = mod(t, S.loopSec);
  blip(S.t);
}

// About 80 ms of the song from loop time t, faded in and out over 5 ms, through the song's own output; a new blip
// stops the one before. No clicks.
let blipNode = null;
function blip(t) {
  if (!buffer) return;
  ctx.resume();
  if (blipNode) { try { blipNode.stop(); } catch {} blipNode.disconnect(); }
  const when = ctx.currentTime + 0.005, len = 0.08, fade = 0.005;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(1, when + fade);
  g.gain.setValueAtTime(1, when + len - fade);
  g.gain.linearRampToValueAtTime(0, when + len);
  g.connect(songGain);
  const node = ctx.createBufferSource();
  Object.assign(node, { buffer, loop: true, loopStart: 0, loopEnd: buffer.duration });
  node.connect(g);
  node.start(when, t, len);
  node.onended = () => { g.disconnect(); if (blipNode === node) blipNode = null; };
  blipNode = node;
  S.blips.push({ when, t });
  if (S.blips.length > 64) S.blips.shift();
}

// The lookahead loop: schedule every click that falls in [scheduledUntil, currentTime + HORIZON).
function schedule() {
  if (!S.playing) return;
  const from = Math.max(scheduledUntil, playWhen), to = ctx.currentTime + HORIZON, L = S.loopSec;
  if (S.clicksOn && to > from) {
    for (let k = Math.floor((from - S.startedAt) / L); S.startedAt + k * L < to; k++) {
      for (const c of S.clickTimes) {
        const when = S.startedAt + k * L + mod(c.t, L);
        if (when >= from && when < to) startClick(when, c);
      }
    }
  }
  scheduledUntil = Math.max(scheduledUntil, to);
  const old = ctx.currentTime - 0.5;
  queued = queued.filter((q) => q.when > old);
}

function startClick(when, c) {
  // a tick that came late (a throttled background tab) skips the click: silent beats a click off the grid
  if (when < ctx.currentTime) return;
  const node = ctx.createBufferSource();
  node.buffer = c.down ? hiClick : loClick;
  node.connect(clickGain);
  node.start(when);
  queued.push({ node, when });
  S.clicks.push({ when, beat: c.beat, down: c.down });
  if (S.clicks.length > 512) S.clicks.splice(0, S.clicks.length - 512);
}

// Clicks not yet sounding are taken back (stop() on a node that has not started cancels it).
function cancelClicks() {
  const now = ctx.currentTime, gone = new Set();
  for (const q of queued) if (q.when > now) { try { q.node.stop(); } catch {} gone.add(q.when); }
  queued = queued.filter((q) => q.when <= now);
  S.clicks = S.clicks.filter((c) => !(c.when > now && gone.has(c.when)));
  scheduledUntil = Math.max(now, playWhen);
}

function rescheduleClicks() {
  if (!S.playing) return;
  cancelClicks();
  schedule();
}

// ---------------- the animation (iframe) ----------------

const frame = $('#frame');
let fwin = null, stage = { width: 1440, height: 1440 }, forceSeek = true;

async function loadFrame(reload) {
  fwin = null;
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  if (reload) frame.contentWindow.location.reload(); else frame.src = '/index.html';
  await loaded;
  const w = frame.contentWindow;
  if (typeof w.seek !== 'function' || !w.ready) throw new Error('index.html has no seek(t) and ready (is this a motion-video project?)');
  await w.ready;
  stage = w.STAGE ?? stage;
  fwin = w; forceSeek = true;
  fitFrame();
}

function fitFrame() {
  const box = $('#frame-box').getBoundingClientRect(), s = Math.min(box.width / stage.width, box.height / stage.height);
  Object.assign(frame.style, { width: `${stage.width}px`, height: `${stage.height}px`,
    left: `${(box.width - stage.width * s) / 2}px`, top: `${(box.height - stage.height * s) / 2}px`, transform: `scale(${s})` });
}

// The animation previews the nudge, swing and markers when the project has rebuild(); an old copy without it
// shows the saved grid until Save reloads it.
function rebuildFrame() {
  rebuildQueued = false;
  if (!fwin || typeof fwin.rebuild !== 'function') return;
  try {
    fwin.rebuild(S.anim);
    S.rebuilds++; S.warning = null; forceSeek = true;
  } catch (e) {
    S.warning = `the animation keeps the previous grid: ${e.message.replace(/^motion-kit: /, '')}`;
  }
  renderStatus();
}

// ---------------- drawing: waveform, grid, playhead, overview, flags ----------------

const wave = $('#wave'), over = $('#overview'), flags = $('#flags');
let overviewImage = null;
const barSec = () => S.grid.beats_per_bar * S.grid.beat_sec;
const span = () => S.viewBars * barSec();

function sizeCanvas(c) {
  const dpr = window.devicePixelRatio || 1, w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; return true; }
  return false;
}

// Every x (CSS px) at which loop time `t` appears in a view of `width` px from viewStart (the view wraps the loop).
function xsOf(t, viewStart, V, width) {
  const L = S.loopSec, out = [];
  for (let u = t + L * Math.ceil((viewStart - t) / L); u <= viewStart + V; u += L) out.push(((u - viewStart) / V) * width);
  return out;
}

function peakAt(a, b) { // the loudest bucket over loop seconds [a, b), wrapping
  const n = peaks.n, i0 = Math.floor(mod(a, S.loopSec) * PEAK_RATE), cnt = Math.max(1, Math.ceil((b - a) * PEAK_RATE));
  let v = 0;
  for (let k = 0; k < cnt; k++) { const x = peaks.max[(i0 + k) % n]; if (x > v) v = x; }
  return v * peaks.norm;
}

function gridLines(draw) { // draw(t, kind, beatIndex): kind 'bar' | 'beat' | 'half'
  const g = S.grid, bpb = g.beats_per_bar, swung = (g.sync?.swing ?? 0.5) !== 0.5;
  g.beats.forEach((_, i) => {
    draw(beatTime(g, i), i % bpb === 0 ? 'bar' : 'beat', i);
    if (swung) draw(beatTime(g, i + 0.5), 'half', i);
  });
}

function drawWave() {
  sizeCanvas(wave);
  const dpr = window.devicePixelRatio || 1, W = wave.width / dpr, H = wave.height / dpr, c = wave.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#0B0B0B'; c.fillRect(0, 0, W, H);
  const V = span(), v0 = S.viewStart, mid = RULER + (H - RULER) / 2, amp = (H - RULER) / 2 - 8;
  // ruler band
  c.fillStyle = '#1c1c1c'; c.fillRect(0, 0, W, RULER);
  c.fillStyle = '#303030'; c.fillRect(0, RULER - 1, W, 1);
  // waveform: one column per CSS px
  c.fillStyle = '#6f6b67';
  for (let x = 0; x < W; x++) {
    const a = v0 + (x / W) * V, h = Math.max(0.5, peakAt(a, a + V / W) * amp);
    c.fillRect(x, mid - h, 1, h * 2);
  }
  // grid
  const bpb = S.grid.beats_per_bar;
  gridLines((t, kind, i) => {
    for (const x of xsOf(t, v0, V, W)) {
      if (kind === 'bar') {
        c.fillStyle = 'rgba(236,234,230,0.85)'; c.fillRect(Math.round(x) - 1, RULER, 2, H - RULER);
        c.fillStyle = '#ECEAE6'; c.font = '600 11px ui-monospace, Menlo, monospace'; c.textBaseline = 'middle';
        c.fillText(String(Math.floor(i / bpb) + 1), Math.round(x) + 4, RULER / 2);
        c.fillRect(Math.round(x) - 1, 4, 2, RULER - 5);
      } else if (kind === 'beat') {
        c.fillStyle = 'rgba(236,234,230,0.4)'; c.fillRect(Math.round(x), RULER, 1, H - RULER);
        c.fillRect(Math.round(x), RULER - 6, 1, 5);
      } else {
        c.fillStyle = 'rgba(236,234,230,0.2)'; c.fillRect(Math.round(x), RULER, 1, H - RULER);
      }
    }
  });
  // playhead: a line and a head in the ruler
  for (const x of xsOf(S.t, v0, V, W)) {
    c.fillStyle = '#FFFFFF'; c.fillRect(Math.round(x) - 0.5, RULER, 1.5, H - RULER);
    c.beginPath(); c.moveTo(x - 6, 2); c.lineTo(x + 6, 2); c.lineTo(x, RULER - 2); c.closePath(); c.fill();
  }
  placeFlags(W, V, v0);
}

function drawOverview() {
  const changed = sizeCanvas(over), dpr = window.devicePixelRatio || 1, W = over.width / dpr, H = over.height / dpr;
  const c = over.getContext('2d'), L = S.loopSec;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (changed || !overviewImage) {
    c.fillStyle = '#0B0B0B'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#4a4744';
    for (let x = 0; x < W; x++) { const a = (x / W) * L, h = Math.max(0.5, peakAt(a, a + L / W) * (H / 2 - 4)); c.fillRect(x, H / 2 - h, 1, h * 2); }
    overviewImage = c.getImageData(0, 0, over.width, over.height);
  } else c.putImageData(overviewImage, 0, 0);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bpb = S.grid.beats_per_bar;
  c.fillStyle = 'rgba(236,234,230,0.35)';
  S.grid.beats.forEach((_, i) => { if (i % bpb === 0) c.fillRect(Math.round((mod(beatTime(S.grid, i), L) / L) * W), 0, 1, H); });
  // the waveform's window (it may wrap the loop end)
  const V = Math.min(span(), L), a = mod(S.viewStart, L);
  c.fillStyle = 'rgba(236,234,230,0.12)'; c.strokeStyle = 'rgba(236,234,230,0.6)';
  for (const [x0, x1] of a + V <= L ? [[a, a + V]] : [[a, L], [0, a + V - L]]) {
    c.fillRect((x0 / L) * W, 0, ((x1 - x0) / L) * W, H);
    c.strokeRect((x0 / L) * W + 0.5, 0.5, ((x1 - x0) / L) * W - 1, H - 1);
  }
  c.fillStyle = '#e8590c';
  for (const m of S.anim.markers) if (m.in_loop) c.fillRect(Math.round((m.t / L) * W) - 1, 0, 2, H);
  c.fillStyle = '#FFFFFF'; c.fillRect(Math.round((S.t / L) * W), 0, 1.5, H);
}

// Markers are DOM flags over the canvas (draggable, focusable); `draft` is the one being named.
// (a marker name never starts with _, so the draft cannot clash with one)
const DRAFT = '_draft';
let draft = null;
function placeFlags(W, V, v0) {
  const want = new Map(S.anim.markers.filter((m) => m.in_loop).map((m) => [m.name, m.t]));
  if (draft) want.set(DRAFT, draft.t - S.song.loop.start_sec);
  for (const el of [...flags.children]) if (!want.has(el.dataset.marker)) el.remove();
  for (const [name, t] of want) {
    let el = flags.querySelector(`[data-marker="${CSS.escape(name)}"]`);
    if (!el) el = name === DRAFT ? draftFlag() : markerFlag(name);
    const xs = xsOf(t, v0, V, W);
    el.style.display = xs.length ? '' : 'none';
    if (xs.length) el.style.left = `${xs[0]}px`;
    el.classList.toggle('selected', S.selected === name);
    if (name !== DRAFT) {
      const note = S.pending.markers.find((m) => m.name === name)?.note;
      el.querySelector('.flag').title = `${name}${note ? `: ${note}` : ''}\nDrag to move, a note in the markers list (N), Delete or right-click to remove`;
    }
  }
}

function markerFlag(name) {
  const el = document.createElement('div');
  el.className = 'marker'; el.dataset.marker = name;
  el.innerHTML = '<div class="stem"></div><div class="flag" tabindex="0"></div>';
  const flag = el.querySelector('.flag');
  flag.textContent = name;
  flag.title = `${name}: drag to move, Delete or right-click to remove`;
  flag.addEventListener('contextmenu', (e) => { e.preventDefault(); removeMarker(name); });
  flag.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    S.selected = name; flag.focus(); renderMarkerList();
    flag.setPointerCapture(e.pointerId);
    const m = S.pending.markers.find((x) => x.name === name), x0 = e.clientX, t0 = m.t;
    const pps = wave.clientWidth / span(), lo = S.song.loop.start_sec, hi = lo + S.loopSec - 0.001;
    const move = (ev) => { m.t = Math.round(clamp(t0 + (ev.clientX - x0) / pps, lo, hi) * 1000) / 1000; refresh(); };
    const up = () => { flag.removeEventListener('pointermove', move); flag.removeEventListener('pointerup', up); flag.removeEventListener('pointercancel', up); };
    flag.addEventListener('pointermove', move);
    flag.addEventListener('pointerup', up);
    flag.addEventListener('pointercancel', up);
  });
  flags.append(el);
  return el;
}

function draftFlag() {
  const el = document.createElement('div');
  el.className = 'marker'; el.dataset.marker = DRAFT;
  el.innerHTML = '<div class="stem"></div><div class="flag"><input class="namebox" maxlength="40" placeholder="name, then Enter" aria-label="Marker name"></div>';
  const input = el.querySelector('input');
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commitDraft(input.value.trim()); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelDraft(); }
  });
  input.addEventListener('input', () => { el.classList.remove('invalid'); S.warning = null; renderStatus(); });
  input.addEventListener('blur', () => { if (draft) cancelDraft(); });
  flags.append(el);
  queueMicrotask(() => input.focus());
  return el;
}

function newMarker() {
  if (draft) return;
  const t = clockT();
  draft = { t: Math.round((t + S.song.loop.start_sec) * 1000) / 1000 };
  if (!S.playing) S.t = t;
  drawWave();
}

function commitDraft(name) {
  const el = flags.querySelector('[data-marker="_draft"]');
  const why = !NAME.test(name) ? 'a marker name is lowercase letters, digits and -, starting with a letter'
    : S.pending.markers.some((m) => m.name === name) ? `there is already a marker called ${name}` : null;
  if (why) { el?.classList.add('invalid'); S.warning = why; renderStatus(); return false; }
  S.pending.markers.push({ name, t: draft.t });
  S.pending.markers.sort((a, b) => a.t - b.t);
  draft = null; el?.remove();
  S.selected = name; S.warning = null;
  refresh();
  return true;
}

function cancelDraft() {
  draft = null;
  flags.querySelector('[data-marker="_draft"]')?.remove();
  S.warning = null; renderStatus();
}

// Notes: the selected marker's line in the markers list holds a visible note field ("add a note", pre-filled). Enter
// or clicking away keeps a changed note (empty removes it), Esc drops the edit, N focuses the field, and Ctrl/Cmd+S
// inside it keeps the note and saves. A note is for people only: it never moves the grid or clears "Sounds right".
const NOTE_MAX = 200;
const noteField = () => $('#marker-list .notebox');

// Keeps the open field's text as the selected marker's note; true when that changed the note.
function commitNote() {
  const input = noteField(), m = input && S.pending.markers.find((x) => x.name === input.dataset.marker);
  if (!m) return false;
  const text = input.value.trim().slice(0, NOTE_MAX);
  if (text === (m.note ?? '')) return false;
  if (text) m.note = text; else delete m.note;
  refresh();
  return true;
}

function focusNote() {
  const input = noteField();
  if (input) { input.focus(); input.select(); }
}

// One line per marker: name, song time, note; a click selects it and moves the playhead there (a marker outside the
// loop is listed but cannot be jumped to).
const fmtSong = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`;
function renderMarkerList() {
  const list = $('#marker-list'), start = S.song.loop.start_sec, open = noteField();
  // never rebuild under the user's typing
  if (open && document.activeElement === open && open.dataset.marker === S.selected) return;
  list.hidden = !S.pending.markers.length;
  list.replaceChildren(...S.pending.markers.map((m) => {
    const inLoop = m.t - start >= 0 && m.t - start < S.loopSec, selected = S.selected === m.name;
    const row = document.createElement('div');
    row.className = `mrow${inLoop ? '' : ' outside'}${selected ? ' selected' : ''}`;
    row.dataset.marker = m.name;
    row.innerHTML = '<span class="mname"></span><span class="mtime mono"></span>';
    row.querySelector('.mname').textContent = m.name;
    row.querySelector('.mtime').textContent = fmtSong(m.t) + (inLoop ? '' : ' · outside loop');
    if (selected) {
      const input = document.createElement('input');
      Object.assign(input, { className: 'notebox', maxLength: NOTE_MAX, value: m.note ?? '', placeholder: 'add a note' });
      input.dataset.marker = m.name;
      input.setAttribute('aria-label', `Note for ${m.name}`);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitNote(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); input.value = m.note ?? ''; input.blur(); }
      });
      input.addEventListener('blur', () => { if (!commitNote()) renderMarkerList(); });
      row.append(input);
    } else {
      const note = document.createElement('span');
      note.className = `mnote${m.note ? '' : ' empty'}`;
      note.textContent = m.note || 'no note';
      row.append(note);
    }
    row.title = inLoop ? 'Select, and move the playhead here' : 'Outside the loop: move the window with --start-bar to use it';
    row.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
    row.addEventListener('click', (e) => {
      if (e.target.closest('input')) return;
      S.selected = m.name;
      const at = m.t - S.song.loop.start_sec; // read now: a Save since this line was drawn may have moved the window
      if (at >= 0 && at < S.loopSec) seekTo(at);
      renderMarkerList();
    });
    return row;
  }));
}

function removeMarker(name) {
  S.pending.markers = S.pending.markers.filter((m) => m.name !== name);
  if (S.selected === name) S.selected = null;
  refresh();
}

// ---------------- controls, readouts, status ----------------

function renderControls() {
  if (!S.pending) return;
  const p = S.pending, n = p.nudge_ms;
  $('#play').classList.toggle('playing', S.playing);
  $('#play .label').textContent = S.playing ? 'Stop' : 'Play';
  $('#clicks').setAttribute('aria-pressed', String(S.clicksOn));
  $('#clicks').textContent = S.clicksOn ? 'Clicks on' : 'Clicks off';
  $('#nudge').textContent = `${n > 0 ? '+' : ''}${n} ms`;
  $('#tempo').textContent = `${(p.bpm ?? S.song.bpm).toFixed(1)} BPM`;
  const left = MIN_TAPS - S.taps.length;
  $('#tap').textContent = S.tapBpm != null ? `tap ${S.tapBpm.toFixed(1)}, Enter` : S.taps.length ? `tap ${left} more`
    : p.bpm != null ? 'tapped' : 'detected';
  $('#tap').classList.toggle('muted', S.tapBpm == null);
  $('#tempo-auto').hidden = p.bpm == null;
  $('#meter').value = p.meter;
  $('#meter-note').textContent = p.meter === '6/8' ? '2 dotted beats a bar' : `${METERS[p.meter]} beats a bar`;
  $('#swing').value = String(p.swing);
  $('#swing-out').textContent = p.swing.toFixed(2);
  $('#swing-note').textContent = p.swing === 0.5 ? 'straight' : Math.abs(p.swing - 0.67) < 0.006 ? 'triplet' : 'swung';
  const checked = p.checked_by_ear;
  $('#right').textContent = checked ? `Checked ${checked}` : 'Sounds right';
  $('#right').classList.toggle('on', !!checked);
  $('#save').classList.toggle('dirty', S.dirty);
  $('#save').disabled = S.saving;
  $('#save').textContent = S.saving ? 'Saving' : 'Save';
  renderMarkerList();
  renderStatus();
}

function renderStatus() {
  if (!S.song) return;
  const parts = [];
  const conf = S.song.bpm_confidence;
  parts.push(`<span>confidence ${conf != null ? conf.toFixed(2) : 'n/a'}${conf != null && conf < 0.5 ? ' (low: check by ear)' : ''}</span>`);
  const checked = S.pending.checked_by_ear;
  parts.push(`<span>${checked ? `checked by ear ${esc(checked)}` : 'not checked by ear'}</span>`);
  const outside = S.anim.markers.filter((m) => !m.in_loop).map((m) => m.name);
  if (outside.length) parts.push(`<span>outside the loop: ${outside.map(esc).join(', ')}</span>`);
  // the analyser snaps beats to detected hits until the user sets a nudge or tempo; then the grid is even, so the
  // first nudge can move clicks by more than its 5 ms
  parts.push(`<span>${S.pending.nudge_ms || S.pending.bpm != null ? 'even grid: detected hits off' : 'grid follows detected hits'}</span>`);
  if (S.pending.bpm !== savedSync(S.song).bpm || S.pending.meter !== savedSync(S.song).meter) parts.push('<span class="warn">preview is approximate until you save</span>');
  if (S.saving) parts.push('<span class="warn">saving: re-cutting the clip</span>');
  else if (S.dirty) parts.push('<span class="warn">unsaved changes</span>');
  if (S.lastSaved) parts.push(`<span>saved ${pad(S.lastSaved.getHours())}:${pad(S.lastSaved.getMinutes())}:${pad(S.lastSaved.getSeconds())}</span>`);
  if (S.warning) parts.push(`<span class="warn">${esc(S.warning)}</span>`);
  if (S.error) parts.push(`<span class="error">${esc(S.error)}</span>`);
  $('#status').innerHTML = parts.join('');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function toggleClicks() { S.clicksOn = !S.clicksOn; rescheduleClicks(); renderControls(); }

function nudge(ms) { S.pending.nudge_ms += ms; gridChanged(); }

function tap(ms) {
  if (S.taps.length && ms - S.taps.at(-1) > TAP_GAP_MS) S.taps = [];
  S.taps.push(ms);
  if (S.taps.length > 16) S.taps.shift();
  const n = S.taps.length;
  S.tapBpm = n >= MIN_TAPS ? Math.round((60000 / ((S.taps[n - 1] - S.taps[0]) / (n - 1))) * 10) / 10 : null;
  renderControls();
}

function applyTap() {
  const bpm = S.tapBpm;
  S.taps = []; S.tapBpm = null;
  if (!(bpm >= BPM_RANGE[0] && bpm <= BPM_RANGE[1])) { S.warning = `a tapped tempo must be ${BPM_RANGE[0]} to ${BPM_RANGE[1]} BPM, got ${bpm}`; return renderControls(); }
  S.pending.bpm = bpm; S.warning = null;
  gridChanged();
}

async function save() {
  if (S.saving || !S.pending) return;
  commitNote(); // a note being typed is kept first (Ctrl/Cmd+S from inside its field)
  // a marker still being named must be named first: an empty or invalid name keeps the prompt open and saves nothing
  if (draft && !commitDraft(flags.querySelector('.namebox')?.value.trim() ?? '')) {
    if (!S.warning) S.warning = 'name the new marker (or press Esc) before saving';
    flags.querySelector('.namebox')?.focus();
    return renderStatus();
  }
  S.saving = true; S.error = null;
  renderControls();
  const posted = JSON.stringify(S.pending);
  try {
    const r = await fetch('/__sync/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sync: S.pending }) });
    let j = null;
    try { j = await r.json(); } catch {}
    if (!r.ok || !j?.song) throw new Error(j?.error ?? `Save failed (HTTP ${r.status})`);
    const was = S.playing;
    if (was) stop();
    S.song = j.song;
    // edits made while saving stay pending; otherwise take the section as the server wrote it
    if (JSON.stringify(S.pending) === posted) S.pending = savedSync(S.song);
    await loadClip();
    S.t = mod(S.t, S.loopSec); // the loop may be shorter now (a tempo or meter change)
    animKey = null;
    refresh();
    if (fwin && typeof fwin.rebuild === 'function') rebuildFrame();
    else { await loadFrame(true); S.iframeReloads++; rebuildQueued = false; }
    S.lastSaved = new Date();
    S.saves++;
    if (was) play();
  } catch (e) {
    S.error = e.message;
  } finally {
    S.saving = false;
    renderControls();
  }
}

// ---------------- input ----------------

addEventListener('keydown', (e) => {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if ((e.ctrlKey || e.metaKey) && key === 's') { e.preventDefault(); save(); return; }
  if (e.target.closest?.('.namebox, .notebox')) return; // the name and note boxes have their own keys
  if (e.ctrlKey || e.metaKey || !S.pending) return;
  const take = () => e.preventDefault();
  if (key === 'ArrowLeft' || key === 'ArrowRight') { take(); return scrub(key === 'ArrowLeft' ? -1 : 1, e.altKey ? 'beat' : e.shiftKey ? 'quarter' : 'fine'); }
  if (e.altKey) return;
  switch (key) {
    case ' ': take(); if (!e.repeat) toggle(); break;
    case 'ArrowUp': case 'ArrowDown': take(); nudge((key === 'ArrowDown' ? -1 : 1) * (e.shiftKey ? 20 : 5)); break;
    case 'Home': take(); scrubTo(0); break;
    case 't': take(); if (!e.repeat) tap(e.timeStamp); break;
    case 'Enter': if (S.tapBpm != null) { take(); applyTap(); } break;
    case 'm': take(); if (!e.repeat) newMarker(); break;
    case 'n': if (S.selected) { take(); focusNote(); } break;
    case 'c': take(); toggleClicks(); break;
    case 'Delete': case 'Backspace': if (S.selected) { take(); removeMarker(S.selected); } break;
    case 'Escape': S.selected = null; S.taps = []; S.tapBpm = null; renderControls(); break;
  }
}, true);

// buttons never keep focus, so Space and Enter stay the page's keys
for (const b of document.querySelectorAll('button')) b.addEventListener('mousedown', (e) => e.preventDefault());
$('#play').addEventListener('click', toggle);
$('#clicks').addEventListener('click', toggleClicks);
$('#right').addEventListener('click', () => { S.pending.checked_by_ear = today(); refresh(); });
$('#save').addEventListener('click', save);
$('#tempo-auto').addEventListener('click', () => { S.pending.bpm = null; gridChanged(); });
$('#meter').addEventListener('change', (e) => { S.pending.meter = e.target.value; e.target.blur(); gridChanged(); });
// swing is not gridChanged(): it only moves the off-beats, not the beats "Sounds right" checked (the server agrees)
$('#swing').addEventListener('input', (e) => { S.pending.swing = Math.round(Number(e.target.value) * 100) / 100; refresh(); });
$('#swing').addEventListener('change', (e) => e.target.blur());

// waveform: click moves the playhead; wheel scrolls; Ctrl+wheel (and pinch) zooms about the pointer
wave.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !S.pending) return;
  S.selected = null;
  seekTo(S.viewStart + (e.offsetX / wave.clientWidth) * span());
});
wave.addEventListener('wheel', (e) => {
  if (!S.pending) return;
  e.preventDefault();
  const W = wave.clientWidth, V = span();
  if (e.ctrlKey) {
    const at = S.viewStart + (e.offsetX / W) * V;
    S.viewBars = clamp(S.viewBars * Math.exp(e.deltaY * 0.0025), ...VIEW_BARS);
    S.viewStart = at - (e.offsetX / W) * span();
  } else {
    S.viewStart += ((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / W) * V;
  }
  S.follow = false;
}, { passive: false });

// overview: drag the window, or click outside it to jump there
// overview: a click (under 4 px of movement) moves the playhead there and centres the view on it (a seek while
// playing, a blip while stopped); a drag that starts on the view's window pans the view and leaves the playhead
over.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !S.pending) return;
  const W = over.clientWidth, L = S.loopSec, at = (e.offsetX / W) * L, V = Math.min(span(), L);
  const inWindow = mod(at - S.viewStart, L) <= V, x0 = e.clientX, v0 = S.viewStart;
  let dragging = false;
  over.setPointerCapture(e.pointerId);
  const move = (ev) => {
    if (!dragging && Math.abs(ev.clientX - x0) < 4) return;
    if (!inWindow) return;
    dragging = true; S.follow = false;
    S.viewStart = v0 + ((ev.clientX - x0) / W) * L;
  };
  const up = () => {
    over.removeEventListener('pointermove', move); over.removeEventListener('pointerup', up);
    if (dragging) return;
    scrubTo(at);
    S.viewStart = at - span() / 2;
    S.follow = S.playing;
  };
  over.addEventListener('pointermove', move);
  over.addEventListener('pointerup', up);
});

addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
new ResizeObserver(() => { fitFrame(); overviewImage = null; }).observe($('#main'));

// ---------------- the frame loop ----------------

function tick() {
  requestAnimationFrame(tick);
  if (!S.pending) return;
  if (S.playing) S.t = clockT();
  const V = span();
  if (S.follow && S.playing) S.viewStart = S.t - V * 0.25;
  else if (S.follow && mod(S.t - S.viewStart, S.loopSec) > V) S.viewStart = S.t - V * 0.25;
  if (rebuildQueued) rebuildFrame();
  if (fwin && (S.t !== S.lastSeek || forceSeek)) {
    try { fwin.seek(S.t); S.lastSeek = S.t; forceSeek = false; } catch (e) { S.warning = `the animation failed at ${S.t.toFixed(3)} s: ${e.message}`; renderStatus(); }
  }
  drawWave();
  drawOverview();
  const b = beatAt(S.grid, S.t), bpb = S.grid.beats_per_bar, whole = Math.floor(b + 1e-9);
  $('#position').textContent = `bar ${Math.floor(whole / bpb) + 1}.${mod(whole, bpb) + 1} \u00b7 ${S.t.toFixed(3)} s`;
}

// ---------------- start ----------------

async function main() {
  await loadTiming();
  const r = await fetch('/song.json', { cache: 'no-store' });
  if (!r.ok) throw new Error(`could not load song.json (HTTP ${r.status})`);
  S.song = await r.json();
  if (!S.song.beats?.length || !S.song.loop) throw new Error('song.json has no beats or loop; run analyze_song.py for this project');
  const L = S.song.loop;
  $('#song-name').textContent = `${S.song.source ?? 'song'}  ·  bar ${L.start_bar ?? '?'}, ${L.bars} bars, ${L.duration_sec.toFixed(2)} s`;
  ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  songGain = ctx.createGain(); songGain.gain.value = 0.9; songGain.connect(ctx.destination);
  clickGain = ctx.createGain(); clickGain.gain.value = 0.5; clickGain.connect(ctx.destination);
  hiClick = makeClick(1500); loClick = makeClick(1000);
  await Promise.all([loadClip(), loadFrame(false)]);
  S.pending = savedSync(S.song);
  refresh();
  rebuildQueued = false; // the iframe already shows the saved song
  S.viewStart = -span() * 0.25;
  requestAnimationFrame(tick);
  window.syncReady = true;
}

main().catch((e) => {
  window.syncError = e.message;
  $('#status').innerHTML = `<span class="error">${esc(e.message)}</span>`;
});
