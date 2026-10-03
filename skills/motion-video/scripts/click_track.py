#!/usr/bin/env python3
"""click_track.py OUT BPM [--seconds 40] -- a synthetic beat: a hi-hat-like click on every beat and a 55 Hz kick
on each downbeat (every 4th). For tests, the gallery, and trying the kit with no music to hand."""
import argparse
import sys
import wave

import numpy as np

SR = 44100


def click_track(path, bpm, seconds=40.0, offset=0.37, noise=0.001, hat=0.3, seed=0):
    """Hi-hat-like click on every beat, a 55 Hz kick on each downbeat (every 4th)."""
    rng = np.random.default_rng(seed)
    x = np.zeros(int(seconds * SR))
    beat = 60.0 / bpm
    i = 0
    while offset + i * beat < seconds - 0.3:
        s = int((offset + i * beat) * SR)
        n = int(0.04 * SR)
        tt = np.arange(n) / SR
        x[s:s + n] += hat * np.exp(-tt * 120) * rng.standard_normal(n)
        if i % 4 == 0:
            m = int(0.2 * SR)
            tk = np.arange(m) / SR
            x[s:s + m] += 0.9 * np.exp(-tk * 18) * np.sin(2 * np.pi * 55 * tk)
        i += 1
    x += noise * rng.standard_normal(len(x))
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return path


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("out")
    ap.add_argument("bpm", type=float)
    ap.add_argument("--seconds", type=float, default=40.0)
    a = ap.parse_args(argv)
    if not (a.bpm > 0 and a.seconds > 0):
        ap.error("BPM and --seconds must be positive")
    try:
        click_track(a.out, a.bpm, seconds=a.seconds)
    except OSError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
