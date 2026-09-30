#!/usr/bin/env python3
"""analyze_song.py -- measure a song's beat grid and derive motion-video project rules.

Usage: analyze_song.py SONG [--out DIR] [--bars 7] [--start-bar N] [--fps 60] [--states N]

Writes DIR/song.json (grid + rules) and DIR/clip.wav (the loop window, 10ms edge
fades). Needs ffmpeg and numpy, nothing else. Assumes 4/4 and a steady tempo,
which is true of the programmed music these videos are cut to.
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 22050
N_FFT = 1024
HOP = 256
FPS_ENV = SR / HOP
# Spectral flux peaks a little after the window first contains an onset.
# Calibrated against the click-track tests (downbeat within one video frame).
ENV_TIME_OFFSET = N_FFT / SR
COMFORT = (100.0, 130.0)
SPRING_ZETA = 0.85
SETTLE_BEATS = 0.6
MIN_HOLD_SEC = 1.0


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
    """Spectral-flux onset envelopes: full band, and a low band (<150 Hz) for kicks."""
    frames = np.lib.stride_tricks.sliding_window_view(x, N_FFT)[::HOP] * np.hanning(N_FFT)
    S = np.log1p(100 * np.abs(np.fft.rfft(frames, axis=1)))
    d = np.maximum(np.diff(S, axis=0), 0)
    freqs = np.fft.rfftfreq(N_FFT, 1 / SR)
    full = np.concatenate([[0.0], d.sum(1)])
    low = np.concatenate([[0.0], d[:, freqs <= 150].sum(1)])
    k = np.hanning(7); k /= k.sum()
    smooth = lambda e: np.convolve(e - np.convolve(e, np.ones(43) / 43, "same"), k, "same").clip(0)
    centroid = (S[:, :] * freqs).sum(1) / (S.sum(1) + 1e-9)
    return smooth(full), smooth(low), centroid


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


def analyze(path, bars=7, fps=60, start_bar=None, states=None, bpb=4):
    x = decode(path)
    full, low, centroid = envelopes(x)
    cands = tempo_candidates(full)
    if not cands:
        raise SongError("could not find a beat in this song")
    bpm, phase = fit_grid(full, cands[0][0])
    bpm = round(bpm, 3)  # song.json stores 3 decimals; derive everything from the stored value
    confidence = cands[0][1]
    beat_sec = 60.0 / bpm
    p = 60 * FPS_ENV / bpm
    n_beats = int((len(full) - 1 - phase) / p) + 1
    pos = phase + p * np.arange(n_beats)
    times = np.array([env_time(q) for q in pos])

    low_at = np.interp(pos, np.arange(len(low)), low)
    j = int(np.argmax([low_at[k::bpb].mean() for k in range(bpb)]))
    downbeat_sec = float(times[j])
    n_bars = (n_beats - j) // bpb

    full_at = np.array([full[max(0, int(q) - 2):int(q) + 3].max() for q in pos])
    accent = np.clip(full_at / (np.percentile(full_at, 95) + 1e-9), 0, 1)

    thr = np.percentile(full, 90)
    peak_idx = [i for i in range(1, len(full) - 1)
                if full[i] > thr and full[i] >= full[i - 1] and full[i] >= full[i + 1]]
    peak_t = np.array([env_time(i) for i in peak_idx]) if peak_idx else np.array([])

    bar_rms, bar_cent = [], []
    for b in range(n_bars):
        t0, t1 = times[j + b * bpb], times[j + b * bpb] + bpb * beat_sec
        seg = x[int(t0 * SR):int(t1 * SR)]
        bar_rms.append(20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9))
        f0, f1 = int(t0 * FPS_ENV), int(t1 * FPS_ENV)
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
    if start_bar is not None:
        if not 0 <= start_bar <= last_start:
            raise SongError(f"--start-bar must be between 0 and {last_start}")
        start = start_bar
    else:
        score = lambda b: float(np.mean(bar_rms[b:b + bars]))
        preferred = [b for b in sections if b <= last_start]
        start = max(preferred or range(last_start + 1), key=score)

    total = bars * bpb
    duration = total * beat_sec
    frames = int(round(duration * fps))
    frame_dt = duration / frames
    first = j + start * bpb
    start_sec = float(times[first])
    beats = []
    for i in range(total):
        abs_t = start_sec + i * beat_sec
        t = i * beat_sec
        cue = abs_t
        if peak_t.size:
            k = int(np.argmin(np.abs(peak_t - abs_t)))
            if abs(peak_t[k] - abs_t) <= beat_sec / 8:
                cue = float(peak_t[k])
        cue_rel = cue - start_sec
        if i == 0:
            cue_rel = max(0.0, cue_rel)
        beats.append({"i": i, "t": round(t, 6), "abs_t": round(abs_t, 6),
                      "frame": int(round(t / frame_dt)), "bar": i // bpb, "beat_in_bar": i % bpb,
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
    if states is not None and states > max_states:
        need = math.ceil(states * min_hold / bpb)
        warnings.append(f"{states} states need {states * min_hold} beats at {min_hold} beats each; "
                        f"this loop has {total}. Use --bars {need} or fewer states.")

    return {
        "source": str(path), "bpm": round(bpm, 3), "bpm_confidence": round(confidence, 3),
        "alternatives": [round(c[0], 2) for c in cands[1:4]],
        "beat_sec": beat_sec, "beats_per_bar": bpb, "downbeat_sec": round(downbeat_sec, 6), "fps": fps,
        "loop": {"start_sec": round(start_sec, 6), "start_bar": start, "bars": bars,
                 "duration_sec": duration, "frames": frames, "frame_dt": frame_dt},
        "beats": beats,
        "sections": [{"bar": b, "t": round(float(times[j + b * bpb]), 3)} for b in sections],
        "rules": {"max_states": max_states, "min_hold_beats": min_hold,
                  "spring": {"zeta": SPRING_ZETA, "settle_sec": round(SETTLE_BEATS * beat_sec, 4)},
                  "warnings": warnings},
    }


def write_clip(src, start_sec, duration_sec, out_path):
    fade = f"afade=t=in:d=0.01,afade=t=out:st={duration_sec - 0.01:.6f}:d=0.01"
    r = subprocess.run([ffmpeg_bin(), "-v", "error", "-y", "-ss", f"{start_sec:.6f}", "-i", str(src),
                        "-t", f"{duration_sec:.6f}", "-af", fade, "-ar", "48000", "-ac", "2",
                        "-c:a", "pcm_s16le", str(out_path)], capture_output=True)
    if r.returncode != 0:
        raise SongError(f"could not write clip: {r.stderr.decode(errors='replace')[:300]}")


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
    ap.add_argument("--start-bar", type=int)
    ap.add_argument("--fps", type=positive_int, default=60)
    ap.add_argument("--states", type=int)
    a = ap.parse_args(argv)
    try:
        song = analyze(a.song, bars=a.bars, fps=a.fps, start_bar=a.start_bar, states=a.states)
        out = Path(a.out)
        out.mkdir(parents=True, exist_ok=True)
        write_clip(a.song, song["loop"]["start_sec"], song["loop"]["duration_sec"], out / "clip.wav")
        (out / "song.json").write_text(json.dumps(song, indent=2))
    except (SongError, OSError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    L = song["loop"]
    print(f"{song['bpm']:.2f} BPM (confidence {song['bpm_confidence']:.2f}; alternatives {song['alternatives']})")
    print(f"loop: bar {L['start_bar']} at {L['start_sec']:.2f}s, {L['bars']} bars = {L['duration_sec']:.3f}s, {L['frames']} frames")
    print(f"rules: <= {song['rules']['max_states']} states, >= {song['rules']['min_hold_beats']} beats each, "
          f"spring settle {song['rules']['spring']['settle_sec']}s")
    for w in song["rules"]["warnings"]:
        print(f"warning: {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
