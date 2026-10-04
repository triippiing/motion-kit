#!/usr/bin/env python3
"""analyze_song.py -- measure a song's beat grid and derive motion-video project rules.

Usage: analyze_song.py SONG [--out DIR] [--bars 7] [--start-bar N | --start-near SEC | --from-start] [--fps 60]
                       [--states N]

Writes DIR/song.json (grid + rules), DIR/clip.wav (the loop window, 10ms edge
fades) and DIR/.source.json (the song's absolute path, local only). Needs ffmpeg
and numpy, nothing else. Assumes a steady tempo, which is true of the programmed
music these videos are cut to.

The `sync` section of an existing DIR/song.json belongs to the user and is kept.
It is applied to the grid: `bpm` fixes the tempo, `meter` sets beats per bar,
`nudge_ms` shifts every beat, and `markers` (song time) are listed for the loop.
`tempo_map` ([{t, bpm, ramp}], replacing bpm) lays the grid at the map's tempo; `pickup_beats` counts the beats
before the first downbeat, which --from-start puts at the start of the loop (they are bar -1). `dismissed` hides
suggestions. When the user set the grid (a nudge, a bpm or a tempo map), beats are not snapped to onsets.

A derived `suggestions` object (song_suggest.py: tempo map, swing, meter, pickup) is written on every run; nothing
in it is applied until the user keeps it in `sync`.
"""
import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

import song_suggest

SR = 22050
N_FFT = 1024
HOP = 256
FPS_ENV = SR / HOP
# Spectral flux peaks a little after the window first contains an onset.
# Calibrated against the click-track tests (downbeat within one video frame).
ENV_TIME_OFFSET = N_FFT / SR
HIGH_HZ = 5000.0  # the high band's floor (song_suggest's swing)
COMFORT = (100.0, 130.0)
SPRING_ZETA = 0.85
SETTLE_BEATS = 0.6
MIN_HOLD_SEC = 1.0
UMASK = os.umask(0); os.umask(UMASK)
METERS = {"4/4": 4, "3/4": 3, "6/8": 2}
SYNC_BPM = (40.0, 240.0)
SWING = (0.5, 0.75)
MARKER_NAME = re.compile(r"[a-z][a-z0-9-]*")
CHECKED_DATE = re.compile(r"\d{4}-\d{2}-\d{2}", re.ASCII)
NOTE_MAX = 200  # a marker's optional note: free text for people, never read for timing


class SongError(Exception):
    pass


def ffmpeg_bin():
    for p in (shutil.which("ffmpeg"), "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"):
        if p and os.path.exists(p):
            return p
    raise SongError("ffmpeg not found. Install it with: brew install ffmpeg")


def decode(path, sr=SR):
    if not Path(path).is_file():
        raise SongError(f"no such file: {path}")
    r = subprocess.run([ffmpeg_bin(), "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(sr),
                        "-f", "f32le", "-"], capture_output=True)
    if r.returncode != 0:
        raise SongError(f"ffmpeg could not decode {path}: {r.stderr.decode(errors='replace').strip()[:300]}")
    x = np.frombuffer(r.stdout, np.float32).astype(np.float64)
    if x.size < sr * 2:
        raise SongError(f"{path} is shorter than 2 seconds of audio")
    if np.max(np.abs(x)) < 1e-3:
        raise SongError(f"{path} is silent")
    return x


def env_time(i):
    return i * HOP / SR + ENV_TIME_OFFSET


def envelopes(x):
    """Spectral-flux onset envelopes: full band, a low band (<150 Hz) for kicks, the spectral centroid, and a high band
    (>= 5 kHz) where hi-hats, rides and ghost notes carry a swung off-beat (song_suggest's swing reads it)."""
    frames = np.lib.stride_tricks.sliding_window_view(x, N_FFT)[::HOP] * np.hanning(N_FFT)
    S = np.log1p(100 * np.abs(np.fft.rfft(frames, axis=1)))
    d = np.maximum(np.diff(S, axis=0), 0)
    freqs = np.fft.rfftfreq(N_FFT, 1 / SR)
    full = np.concatenate([[0.0], d.sum(1)])
    low = np.concatenate([[0.0], d[:, freqs <= 150].sum(1)])
    k = np.hanning(7); k /= k.sum()
    smooth = lambda e: np.convolve(e - np.convolve(e, np.ones(43) / 43, "same"), k, "same").clip(0)
    high = np.concatenate([[0.0], d[:, freqs >= HIGH_HZ].sum(1)])
    centroid = (S[:, :] * freqs).sum(1) / (S.sum(1) + 1e-9)
    return smooth(full), smooth(low), centroid, smooth(high)


def tempo_candidates(env, lo=60.0, hi=180.0):
    e = env - env.mean()
    n = len(e)
    f = np.fft.rfft(e, 2 * n)
    ac = np.fft.irfft(f * np.conj(f))[:n]
    ac /= ac[0] + 1e-12
    lag_lo, lag_hi = int(60 * FPS_ENV / hi), int(math.ceil(60 * FPS_ENV / lo))
    out = []
    for lag in range(max(lag_lo, 2), min(lag_hi, n - 2) + 1):
        if ac[lag] >= ac[lag - 1] and ac[lag] >= ac[lag + 1] and ac[lag] > 0:
            y0, y1, y2 = ac[lag - 1], ac[lag], ac[lag + 1]
            den = y0 - 2 * y1 + y2
            d = 0.5 * (y0 - y2) / den if den != 0 else 0.0
            bpm = 60 * FPS_ENV / (lag + d)
            prior = math.exp(-0.5 * (math.log2(bpm / 120.0) / 1.0) ** 2)
            out.append((float(bpm), float(ac[lag]), float(ac[lag] * prior)))
    out.sort(key=lambda c: -c[2])
    return out


def fit_grid(env, bpm_guess, span=2.0, step=0.01):
    """Constant-tempo comb fit: the (bpm, phase) whose beat grid sits on most onset energy."""
    idx = np.arange(len(env))
    best = (-1.0, bpm_guess, 0.0)
    for bpm in np.arange(bpm_guess - span, bpm_guess + span + step / 2, step):
        p = 60 * FPS_ENV / bpm
        k = np.arange(int((len(env) - 1) / p))
        phases = np.arange(0, p, 0.5)
        vals = np.interp(phases[:, None] + p * k[None, :], idx, env, right=0.0)
        scores = vals.mean(1)
        j = int(scores.argmax())
        if scores[j] > best[0]:
            best = (float(scores[j]), float(bpm), float(phases[j]))
    return best[1], best[2]


def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validate_tempo_map(tm):
    """sync.tempo_map: None, or a list of {t, bpm, ramp?} anchors, first t 0, t strictly increasing, bpm in SYNC_BPM."""
    if tm is None:
        return
    bad = lambda why: SongError(f"sync tempo_map {why}, got {tm!r}"[:400])
    if not isinstance(tm, list) or not tm:
        raise bad("must be a list of {t, bpm, ramp} anchors")
    prev = None
    for i, a in enumerate(tm):
        if not isinstance(a, dict) or not is_number(a.get("t")) or not is_number(a.get("bpm")):
            raise bad(f"anchor {i + 1} must be an object with a time t and a bpm")
        if not SYNC_BPM[0] <= a["bpm"] <= SYNC_BPM[1]:
            raise bad(f"bpm must be from {SYNC_BPM[0]:g} to {SYNC_BPM[1]:g} (anchor {i + 1})")
        if "ramp" in a and not isinstance(a["ramp"], bool):
            raise bad(f"ramp must be true or false (anchor {i + 1})")
        if prev is None and (a["t"] != 0 or a.get("ramp")):
            raise bad("must start with an anchor at t 0 (not a ramp)")
        if prev is not None and not a["t"] > prev:
            raise bad("anchors must be sorted by increasing t")
        prev = a["t"]


def validate_sync(sync):
    """Check the user's sync section; returns it unchanged, or raises SongError."""
    if sync is None:
        return None
    if not isinstance(sync, dict):
        raise SongError("song.json sync must be an object")
    if "nudge_ms" in sync and not is_number(sync["nudge_ms"]):
        raise SongError(f"sync nudge_ms must be a number of milliseconds, got {sync['nudge_ms']!r}")
    bpm = sync.get("bpm")
    if bpm is not None and not (is_number(bpm) and SYNC_BPM[0] <= bpm <= SYNC_BPM[1]):
        raise SongError(f"sync bpm must be a number from {SYNC_BPM[0]:g} to {SYNC_BPM[1]:g}, got {bpm!r}")
    if "meter" in sync and sync["meter"] not in METERS:
        raise SongError(f"sync meter must be one of {', '.join(METERS)}, got {sync['meter']!r}")
    if "swing" in sync and not (is_number(sync["swing"]) and SWING[0] <= sync["swing"] <= SWING[1]):
        raise SongError(f"sync swing must be a number from {SWING[0]} to {SWING[1]}, got {sync['swing']!r}")
    if "checked_by_ear" in sync and not (isinstance(sync["checked_by_ear"], str)
                                         and CHECKED_DATE.fullmatch(sync["checked_by_ear"])):
        raise SongError(f"sync checked_by_ear must be a date like 2026-10-01, got {sync['checked_by_ear']!r}")
    validate_tempo_map(sync.get("tempo_map"))
    if "pickup_beats" in sync:
        n, bpb = sync["pickup_beats"], METERS[sync.get("meter", "4/4")]
        if not (isinstance(n, int) and not isinstance(n, bool) and 0 <= n < bpb):
            raise SongError(f"sync pickup_beats must be a whole number from 0 to {bpb - 1} "
                            f"(beats before the first downbeat in {sync.get('meter', '4/4')}), got {n!r}")
    dismissed = sync.get("dismissed", [])
    if not isinstance(dismissed, list) or not all(
            isinstance(d, dict) and d.get("key") in song_suggest.SUGGESTION_KEYS and "value" in d for d in dismissed):
        raise SongError(f"sync dismissed must be a list of {{key, value}} with key one of "
                        f"{', '.join(song_suggest.SUGGESTION_KEYS)}, got {dismissed!r}")
    markers = sync.get("markers", [])
    if not isinstance(markers, list):
        raise SongError("sync markers must be a list of {name, t}")
    seen = set()
    for m in markers:
        if not isinstance(m, dict):
            raise SongError(f"sync markers must be objects with a name and a t, got {m!r}")
        name = m.get("name")
        if not isinstance(name, str) or not MARKER_NAME.fullmatch(name):
            raise SongError(f"marker name {name!r} is not valid: use lowercase letters, digits and -, "
                            "starting with a letter")
        if name in seen:
            raise SongError(f"marker name {name!r} is used twice")
        seen.add(name)
        if not (is_number(m.get("t")) and m["t"] >= 0):
            raise SongError(f"marker {name!r} needs a time t in seconds (0 or more), got {m.get('t')!r}")
        if "note" in m and not (isinstance(m["note"], str) and len(m["note"]) <= NOTE_MAX):
            raise SongError(f"marker {name!r} note must be text of at most {NOTE_MAX} characters, got "
                            + (f"{len(m['note'])} characters" if isinstance(m["note"], str) else repr(m["note"])))
    return sync


def beat_grid(full, low, sync=None):
    """The whole-song beat grid analyze() uses: tempo, phase and downbeat from the envelopes (and the user's sync).
    pos are envelope frame indices (pos / FPS_ENV is the envelope's own time base, what song_suggest samples);
    times are song seconds (with the nudge); j is the index of the first downbeat."""
    s = sync or {}
    bpb = METERS[s.get("meter", "4/4")]
    nudge = s.get("nudge_ms", 0) / 1000
    cands = tempo_candidates(full)
    if not cands:
        raise SongError("could not find a beat in this song")
    if s.get("tempo_map") is not None:
        # the user's tempo map (replaces bpm): its tempo, each span's phase fitted to the tracked beats
        bpm = round(float(s["tempo_map"][0]["bpm"]), 3)
        pos = song_suggest.map_grid(full, FPS_ENV, s["tempo_map"], ENV_TIME_OFFSET) * FPS_ENV
        if len(pos) < 2:
            raise SongError("the tempo map leaves fewer than two beats in this song")
        times = pos / FPS_ENV + ENV_TIME_OFFSET + nudge
    else:
        if s.get("bpm") is not None:
            # the user's tempo: only the phase is fitted
            bpm, phase = fit_grid(full, float(s["bpm"]), span=0.0)
        else:
            bpm, phase = fit_grid(full, cands[0][0])
        bpm = round(bpm, 3)  # song.json stores 3 decimals; derive everything from the stored value
        p = 60 * FPS_ENV / bpm
        n_beats = int((len(full) - 1 - phase) / p) + 1
        pos = phase + p * np.arange(n_beats)
        times = np.array([env_time(q) for q in pos]) + nudge
    low_at = np.interp(pos, np.arange(len(low)), low)
    j = int(np.argmax([low_at[k::bpb].mean() for k in range(bpb)]))
    return {"bpm": bpm, "confidence": cands[0][1], "alternatives": [round(c[0], 2) for c in cands[1:4]],
            "pos": pos, "times": times, "j": j, "steady": s.get("tempo_map") is None}


def refit_beats(full, bpm_guess):
    """A constant-tempo grid fitted near bpm_guess (+-2 BPM), for song_suggest's triplet check:
    (bpm, beat times in the envelope's own time base, frame index / FPS_ENV)."""
    bpm, phase = fit_grid(full, bpm_guess)
    p = 60 * FPS_ENV / bpm
    pos = phase + p * np.arange(int((len(full) - 1 - phase) / p) + 1)
    return bpm, pos / FPS_ENV


def analyze(path, bars=7, fps=60, start_bar=None, states=None, sync=None, start_near=None, from_start=False):
    s = sync or {}
    bpb = METERS[s.get("meter", "4/4")]
    user_grid = bool(s.get("nudge_ms")) or s.get("bpm") is not None or s.get("tempo_map") is not None
    x = decode(path)
    song_sec = len(x) / SR
    full, low, centroid, high = envelopes(x)
    g = beat_grid(full, low, sync)
    bpm, confidence, pos, times, j = g["bpm"], g["confidence"], g["pos"], g["times"], g["j"]
    beat_sec = 60.0 / bpm
    n_beats = len(pos)
    downbeat_sec = float(times[j])
    n_bars = (n_beats - j) // bpb

    def beat_at(k):
        """Song time of grid beat k; past the grid's end, the last gap is repeated."""
        if k < n_beats:
            return float(times[k])
        return float(times[-1] + (k - n_beats + 1) * (times[-1] - times[-2]))

    # the time n beats from grid beat k: a steady grid's is exact arithmetic (as it always was); a tempo map's follows it
    span = (lambda k, n: n * beat_sec) if g["steady"] else (lambda k, n: beat_at(k + n) - beat_at(k))

    full_at = np.array([full[max(0, int(q) - 2):int(q) + 3].max() for q in pos])
    accent = np.clip(full_at / (np.percentile(full_at, 95) + 1e-9), 0, 1)

    thr = np.percentile(full, 90)
    peak_idx = [i for i in range(1, len(full) - 1)
                if full[i] > thr and full[i] >= full[i - 1] and full[i] >= full[i + 1]]
    peak_t = np.array([env_time(i) for i in peak_idx]) if peak_idx else np.array([])

    bar_rms, bar_cent = [], []
    for b in range(n_bars):
        t0 = times[j + b * bpb]
        t1 = t0 + span(j + b * bpb, bpb)
        seg = x[max(0, int(t0 * SR)):max(0, int(t1 * SR))]
        bar_rms.append(20 * np.log10(np.sqrt(np.mean(seg ** 2) if seg.size else 0.0) + 1e-9))
        f0, f1 = max(0, int(t0 * FPS_ENV)), min(len(centroid), max(0, int(t1 * FPS_ENV)))
        bar_cent.append(float(centroid[f0:f1].mean()) if f1 > f0 else 0.0)
    F = np.array([bar_rms, bar_cent]).T
    F = (F - F.mean(0)) / (F.std(0) + 1e-9) if n_bars > 1 else F
    novelty = np.zeros(n_bars)
    for b in range(2, n_bars - 1):
        novelty[b] = np.linalg.norm(F[b:b + 2].mean(0) - F[b - 2:b].mean(0))
    cut = novelty.mean() + novelty.std()
    sections = []
    for b in range(2, n_bars - 1):
        if novelty[b] > cut and novelty[b] >= novelty[b - 1] and novelty[b] >= novelty[b + 1] \
                and (not sections or b - sections[-1] >= 4):
            sections.append(b)

    if n_bars < bars:
        raise SongError(f"song is shorter than the requested loop: {n_bars} whole bars available, {bars} asked for")
    last_start = n_bars - bars
    # --from-start: the loop starts on the first pickup beat (sync.pickup_beats before the first audible bar's downbeat)
    lead = s.get("pickup_beats", 0) if from_start else 0
    total = lead + bars * bpb
    if from_start:
        d = song_suggest.first_downbeat(full, FPS_ENV, pos / FPS_ENV, j, bpb)
        start = 0 if d is None else (d - j) // bpb
        if start > last_start:
            raise SongError(f"song is shorter than the requested loop from its first downbeat: "
                            f"{n_bars - start} whole bars available, {bars} asked for")
        if j + start * bpb - lead < 0:
            raise SongError(f"the {lead}-beat pickup would start before the song's first beat")
    elif start_bar is not None:
        if not 0 <= start_bar <= last_start:
            raise SongError(f"--start-bar must be between 0 and {last_start} (or pick the bar by time with --start-near SEC)")
        start = start_bar
    elif start_near is not None:
        start = min(range(last_start + 1), key=lambda b: abs(times[j + b * bpb] - start_near))
    else:
        # prefer windows inside the song: a grid's first or last bar can sit past the audio
        # (a nudge, or just the detected last bar); if none fits, every window is a candidate
        fits = [b for b in range(last_start + 1)
                if times[j + b * bpb] >= 0 and times[j + b * bpb] + span(j + b * bpb, total) <= song_sec]
        fits = fits or list(range(last_start + 1))
        score = lambda b: float(np.mean(bar_rms[b:b + bars]))
        preferred = [b for b in sections if b in fits]
        start = max(preferred or fits, key=score)

    first = j + start * bpb - lead
    duration = span(first, total)
    frames = int(round(duration * fps))
    frame_dt = duration / frames
    start_sec = float(times[first])
    if start_sec < 0:
        raise SongError("the loop window would start before the song (move it with --start-bar); "
                        "--start-near SEC also moves the loop window")
    overrun = start_sec + duration - song_sec
    # a user grid is held to the song; a detected one may end past it (the clip is then padded, with a warning)
    if user_grid and overrun > 0:
        raise SongError("the loop window would end past the end of the song (move it with --start-bar); "
                        "--start-near SEC also moves the loop window")
    beats = []
    for i in range(total):
        if g["steady"]:
            abs_t = start_sec + i * beat_sec
            t = i * beat_sec
        else:
            abs_t = beat_at(first + i)
            t = abs_t - start_sec
        cue = abs_t
        if peak_t.size and not user_grid:
            k = int(np.argmin(np.abs(peak_t - abs_t)))
            if abs(peak_t[k] - abs_t) <= beat_sec / 8:
                cue = float(peak_t[k])
        cue_rel = cue - start_sec
        if i == 0:
            cue_rel = max(0.0, cue_rel)
        beats.append({"i": i, "t": round(t, 6), "abs_t": round(abs_t, 6),
                      "frame": int(round(t / frame_dt)), "bar": (i - lead) // bpb, "beat_in_bar": (i - lead) % bpb,
                      "accent": round(float(accent[min(first + i, n_beats - 1)]), 3),
                      "cue_t": round(cue_rel, 6)})

    # tolerate small tempo-fit error: 119.99 BPM must still count as 120
    min_hold = max(1, math.ceil(MIN_HOLD_SEC / beat_sec - 0.05))
    max_states = total // min_hold
    warnings = []
    if not COMFORT[0] <= bpm <= COMFORT[1]:
        if bpm < COMFORT[0]:
            warnings.append(f"{bpm:.1f} BPM is below the 100–130 comfort range: keep one event per beat "
                            f"but add half-beat accents in busy sections, or treat it as double-time ({2 * bpm:.1f}).")
        else:
            warnings.append(f"{bpm:.1f} BPM is above the 100–130 comfort range: consider half-time "
                            f"({bpm / 2:.1f}) and put an event on every other beat.")
    if confidence < 0.2:
        warnings.append(f"low beat confidence ({confidence:.2f}): check the beat stills against the music by ear.")
    if overrun >= 0.001:
        warnings.append(f"the loop runs {overrun * 1000:.0f} ms past the end of the song; clip.wav is padded with silence")
    if states is not None and states > max_states:
        need = math.ceil(states * min_hold / bpb)
        warnings.append(f"{states} states need {states * min_hold} beats at {min_hold} beats each; "
                        f"this loop has {total}. Use --bars {need} or fewer states.")

    suggestions = song_suggest.suggest(full, low, FPS_ENV, pos / FPS_ENV, bpm, g["alternatives"], j, bpb, sync,
                                       tempo_candidates=tempo_candidates, refit=lambda b: refit_beats(full, b),
                                       time_offset=ENV_TIME_OFFSET, high_env=high)
    song = {
        "source": Path(path).name, "bpm": round(bpm, 3), "bpm_confidence": round(confidence, 3),
        "alternatives": g["alternatives"],
        "beat_sec": beat_sec, "beats_per_bar": bpb, "downbeat_sec": round(downbeat_sec, 6), "fps": fps,
        "loop": {"start_sec": round(start_sec, 6), "start_bar": start, "bars": bars,
                 "duration_sec": duration, "frames": frames, "frame_dt": frame_dt},
        "beats": beats,
        "sections": [{"bar": b, "t": round(float(times[j + b * bpb]), 3)} for b in sections],
        "rules": {"max_states": max_states, "min_hold_beats": min_hold,
                  "spring": {"zeta": SPRING_ZETA, "settle_sec": round(SETTLE_BEATS * beat_sec, 4)},
                  "warnings": warnings},
        "suggestions": suggestions,
    }
    if from_start:
        song["loop"]["from_start"] = True
    if sync is not None:
        # markers are in song time; list them against this loop (their beat is computed by timing.js)
        start_r = round(start_sec, 6)
        song["markers"] = [{"name": m["name"], "song_t": round(float(m["t"]), 6),
                            "t": round(m["t"] - start_r, 6), "in_loop": 0 <= m["t"] - start_r < duration,
                            **({"note": m["note"]} if "note" in m else {})}
                           for m in sync.get("markers", [])]
        song["sync"] = sync
    return song


def write_clip(src, start_sec, duration_sec, out_path):
    # pad with silence to the exact loop length (a loop can end past the song), then fade both ends
    af = (f"apad=whole_dur={duration_sec:.6f},afade=t=in:d=0.01,"
          f"afade=t=out:st={duration_sec - 0.01:.6f}:d=0.01")
    r = subprocess.run([ffmpeg_bin(), "-v", "error", "-y", "-ss", f"{start_sec:.6f}", "-i", str(src),
                        "-t", f"{duration_sec:.6f}", "-af", af, "-ar", "48000", "-ac", "2",
                        "-c:a", "pcm_s16le", str(out_path)], capture_output=True)
    if r.returncode != 0:
        raise SongError(f"could not write clip: {r.stderr.decode(errors='replace')[:300]}")


def read_sync(out):
    """The sync section of an existing DIR/song.json, or None."""
    path = Path(out) / "song.json"
    if not path.is_file():
        return None
    try:
        old = json.loads(path.read_text())
    except (OSError, ValueError):
        old = None
    if not isinstance(old, dict):
        print("warning: could not read the existing song.json; its sync section is not kept", file=sys.stderr)
        return None
    return old.get("sync")


def write_atomic(out, files):
    """Write each {name: writer(tmp_path)} to a temp file in out, then rename them all into place."""
    # atomic per file, not as a set: Save (sync.mjs) keeps song.json.bak and restores it if a run fails
    tmps = {}
    try:
        for name, writer in files.items():
            fd, tmp = tempfile.mkstemp(dir=out, prefix=f".{name}.", suffix=Path(name).suffix)
            os.close(fd)
            tmps[name] = tmp
            os.chmod(tmp, 0o666 & ~UMASK)  # mkstemp makes 0600; keep the usual mode
            writer(tmp)
        for name, tmp in tmps.items():
            os.replace(tmp, Path(out) / name)
    finally:
        for tmp in tmps.values():
            if os.path.exists(tmp):
                os.remove(tmp)


def finite_float(text):
    try:
        v = float(text)
    except ValueError:
        v = math.nan
    if not math.isfinite(v):
        raise argparse.ArgumentTypeError(f"must be a number of seconds, got {text!r}")
    return v


def positive_int(text):
    try:
        n = int(text)
    except ValueError:
        n = 0
    if n < 1:
        raise argparse.ArgumentTypeError(f"must be a positive integer, got {text!r}")
    return n


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("song")
    ap.add_argument("--out", default=".")
    ap.add_argument("--bars", type=positive_int, default=7)
    where = ap.add_mutually_exclusive_group()
    where.add_argument("--start-bar", type=int)
    where.add_argument("--start-near", type=finite_float, metavar="SEC",
                       help="start the loop on the bar nearest this time in the song")
    where.add_argument("--from-start", action="store_true",
                       help="start the loop on the song's first pickup beat (sync.pickup_beats), else its first downbeat")
    ap.add_argument("--fps", type=positive_int, default=60)
    ap.add_argument("--states", type=int)
    a = ap.parse_args(argv)
    try:
        out = Path(a.out)
        sync = validate_sync(read_sync(out))
        song = analyze(a.song, bars=a.bars, fps=a.fps, start_bar=a.start_bar, states=a.states,
                       sync=sync, start_near=a.start_near, from_start=a.from_start)
        out.mkdir(parents=True, exist_ok=True)
        source = {"path": str(Path(a.song).resolve())}
        write_atomic(out, {
            "clip.wav": lambda p: write_clip(a.song, song["loop"]["start_sec"], song["loop"]["duration_sec"], p),
            "song.json": lambda p: Path(p).write_text(json.dumps(song, indent=2)),
            ".source.json": lambda p: Path(p).write_text(json.dumps(source, indent=2)),
        })
    except (SongError, OSError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    L = song["loop"]
    print(f"{song['bpm']:.2f} BPM (confidence {song['bpm_confidence']:.2f}; alternatives {song['alternatives']})")
    print(f"loop: bar {L['start_bar']} at {L['start_sec']:.2f}s, {L['bars']} bars = {L['duration_sec']:.3f}s, {L['frames']} frames")
    print(f"rules: <= {song['rules']['max_states']} states, >= {song['rules']['min_hold_beats']} beats each, "
          f"spring settle {song['rules']['spring']['settle_sec']}s")
    for m in song.get("markers", []):
        print(f"marker {m['name']}: {m['song_t']:.3f}s in the song, "
              + (f"{m['t']:.3f}s into the loop" if m["in_loop"] else "outside the loop"))
    for w in song["rules"]["warnings"]:
        print(f"warning: {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
