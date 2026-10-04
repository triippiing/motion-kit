#!/usr/bin/env python3
"""click_track.py OUT BPM [--seconds 40] [--tempo-map 0:90,20:120r] [--swing 0.62] [--meter 4/4|3/4|6/8] [--pickup N]
-- a synthetic beat: a hi-hat-like click on every beat and a 55 Hz kick on each downbeat (every 4th by default).
For tests, the gallery, and trying the kit with no music to hand."""
import argparse
import math
import sys
import wave

import numpy as np

SR = 44100
METERS = {"4/4": 4, "3/4": 3, "6/8": 2}  # beats per bar; a 6/8 beat is a dotted quarter


def _check_tempo_map(tempo_map):
    tm = [(float(t), float(b), bool(r)) for t, b, r in tempo_map]
    if not tm or tm[0][0] != 0:
        raise ValueError("tempo_map must start with an anchor at t=0")
    for (t0, _, _), (t1, _, _) in zip(tm, tm[1:]):
        if not t1 > t0:
            raise ValueError("tempo_map anchors must be sorted by strictly increasing t")
    for t, b, _ in tm:
        if not (math.isfinite(t) and math.isfinite(b) and b > 0):
            raise ValueError(f"tempo_map anchor ({t:g}, {b:g}) needs a finite time and a positive bpm")
    return tm


def beat_times(bpm, seconds, offset=0.37, tempo_map=None):
    """The beat onsets click_track uses: from `offset`, while before `seconds - 0.3`.
    With a tempo_map [(t, bpm, ramp), ...] (first t 0) beats are placed by integrating the tempo; between anchors it is
    constant at the earlier anchor's bpm, or changes linearly into an anchor whose ramp is True."""
    end = seconds - 0.3
    if tempo_map is None:
        beat = 60.0 / bpm
        out, i = [], 0
        while offset + i * beat < end:  # exactly the positions click_track always used
            out.append(offset + i * beat)
            i += 1
        return out
    tm = _check_tempo_map(tempo_map)
    # segments (t0, t1, bpm at t0, bpm at t1); the last runs on at a constant tempo
    segs = []
    for j, (t0, b0, _) in enumerate(tm):
        if j + 1 < len(tm):
            t1, b1, ramp = tm[j + 1]
            segs.append((t0, t1, b0, b1 if ramp else b0))
        else:
            segs.append((t0, math.inf, b0, b0))
    out, t = [], offset
    k = max(j for j, sg in enumerate(segs) if sg[0] <= t)
    while t < end:
        out.append(t)
        need = 1.0  # beats to the next onset
        while True:
            t0, t1, b0, b1 = segs[k]
            slope = 0.0 if t1 == math.inf else (b1 - b0) / (t1 - t0)  # bpm per second
            bt = b0 + slope * (t - t0)  # bpm at t
            left = math.inf if t1 == math.inf else (bt + b1) / 2 * (t1 - t) / 60  # beats until t1
            if left >= need:
                # solve need = (bt*tau + slope*tau^2/2) / 60 for tau (stable form, also fine when slope is 0)
                t = t + 120 * need / (bt + math.sqrt(max(0.0, bt * bt + 120 * slope * need)))
                break
            need -= left
            t = t1
            k += 1
    return out


def _add(x, s, sig):
    n = min(len(sig), len(x) - s)
    if n > 0:
        x[s:s + n] += sig[:n]


def click_track(path, bpm, seconds=40.0, offset=0.37, noise=0.001, hat=0.3, seed=0,
                tempo_map=None, swing=0.5, meter="4/4", pickup=0):
    """Hi-hat-like click on every beat and a 55 Hz kick on each downbeat. `tempo_map` [(t, bpm, ramp)] overrides bpm;
    `swing` > 0.5 adds a quieter hat at beat + swing x interval; `meter` 4/4, 3/4 or 6/8 (dotted-quarter beats, a kick
    every 2nd, quiet hats at 1/3 and 2/3); `pickup` N hat-only beats before the first kick."""
    if meter not in METERS:
        raise ValueError(f"meter must be one of {', '.join(METERS)}, got {meter!r}")
    bar = METERS[meter]
    if int(pickup) != pickup or not 0 <= pickup < bar:
        raise ValueError(f"pickup must be a whole number from 0 to {bar - 1} in {meter}, got {pickup!r}")
    if not (math.isfinite(swing) and 0.5 <= swing < 1):
        raise ValueError(f"swing must be from 0.5 to below 1, got {swing!r}")
    beats = beat_times(bpm, seconds, offset, tempo_map)
    rng = np.random.default_rng(seed)
    extra = np.random.default_rng(seed + 1)  # swing / compound hats, so the main stream (and the default bytes) is untouched
    x = np.zeros(int(seconds * SR))
    n = int(0.04 * SR)
    tt = np.arange(n) / SR
    env = np.exp(-tt * 120)
    m = int(0.2 * SR)
    tk = np.arange(m) / SR
    kick = 0.9 * np.exp(-tk * 18) * np.sin(2 * np.pi * 55 * tk)
    for i, b in enumerate(beats):
        s = int(b * SR)
        x[s:s + n] += hat * env * rng.standard_normal(n)
        if i >= pickup and (i - pickup) % bar == 0:
            _add(x, s, kick)
        interval = (beats[i + 1] if i + 1 < len(beats) else 2 * b - beats[i - 1] if i else b + 60.0 / bpm) - b
        fracs = ([1 / 3, 2 / 3] if meter == "6/8" else []) + ([swing] if swing > 0.5 else [])
        for f in fracs:
            _add(x, int((b + f * interval) * SR), 0.6 * hat * env * extra.standard_normal(n))
    x += noise * rng.standard_normal(len(x))
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return path


def finite_float(text):
    try:
        v = float(text)
    except ValueError:
        v = math.nan
    if not math.isfinite(v):
        raise argparse.ArgumentTypeError(f"must be a finite number, got {text!r}")
    return v


def tempo_map_arg(text):
    """'0:90,20:120,40:120r' -> [(0, 90, False), (20, 120, False), (40, 120, True)]; 'r' ramps into that anchor."""
    out = []
    for part in text.split(","):
        t, sep, b = part.strip().partition(":")
        ramp = b.endswith("r")
        try:
            t, b = float(t), float(b[:-1] if ramp else b)
        except ValueError:
            t = b = math.nan
        if not sep or not math.isfinite(t) or not math.isfinite(b):
            raise argparse.ArgumentTypeError(f"anchors are T:BPM or T:BPMr separated by commas, got {part!r}")
        out.append((t, b, ramp))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("out")
    ap.add_argument("bpm", type=finite_float)
    ap.add_argument("--seconds", type=finite_float, default=40.0)
    ap.add_argument("--tempo-map", type=tempo_map_arg, help="T:BPM anchors, e.g. 0:90,20:120,40:140r (r = ramp into it)")
    ap.add_argument("--swing", type=finite_float, default=0.5, help="0.5 (straight) to below 1")
    ap.add_argument("--meter", choices=sorted(METERS), default="4/4")
    ap.add_argument("--pickup", type=int, default=0, help="hat-only beats before the first kick")
    a = ap.parse_args(argv)
    # a huge BPM all but hangs the click loop and a huge --seconds the buffer, so both are kept to a sane range
    if not 1 <= a.bpm <= 1000:
        ap.error(f"BPM must be from 1 to 1000, got {a.bpm:g}")
    if not 0 < a.seconds <= 3600:
        ap.error(f"--seconds must be above 0 and at most 3600, got {a.seconds:g}")
    if a.tempo_map is not None:
        try:
            _check_tempo_map(a.tempo_map)
        except ValueError as e:
            ap.error(f"--tempo-map: {e}")
        if not all(1 <= b <= 1000 for _, b, _ in a.tempo_map):
            ap.error("--tempo-map BPMs must be from 1 to 1000")
    if not 0.5 <= a.swing < 1:
        ap.error(f"--swing must be from 0.5 to below 1, got {a.swing:g}")
    if not 0 <= a.pickup < METERS[a.meter]:
        ap.error(f"--pickup must be from 0 to {METERS[a.meter] - 1} in {a.meter}, got {a.pickup}")
    try:
        click_track(a.out, a.bpm, seconds=a.seconds, tempo_map=a.tempo_map, swing=a.swing, meter=a.meter,
                    pickup=a.pickup)
    except OSError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
