#!/usr/bin/env python3
"""song_suggest.py -- detectors behind the analyser's `suggestions` (C2b): swing (with a triplet tempo correction),
meter (3/4, 6/8) and a pickup before the first downbeat.

Suggestions only: these functions never decide anything. Each returns a proposal (with a confidence 0..1 and a one-line
reason) or None; only the user's `sync` (Keep + Save on the sync page) ever changes the grid.

They take numpy arrays and plain numbers, never a path, so this module does not import analyze_song (which imports it).
Time base: `beat_times` are in the envelopes' own time base, frame index / fps_env (analyze_song.beat_grid's
`pos / FPS_ENV`), so an onset sits exactly on its beat. None of the detectors returns a time, so nothing converts back.
"""
import numpy as np

# Starting values from the C2b plan; every later change is recorded in the task reports.
THRESHOLDS = {
    "swing_min": 0.56,      # median off-beat position (fraction of the beat) at or above which swing is suggested
    "swing_share": 0.60,    # share of beats that must have an off-beat onset
    "triplet_tol": 0.02,    # an alternative within this of 3/4 x bpm (relative) seeds the triplet re-fit
    "triplet_fit": 0.75,    # the 3/4-tempo grid's comb score must be at least this share of the current grid's
    "meter_margin": 0.15,   # ac[3] - ac[4] needed for 3/4
    "pickup_onset": 0.35,   # a pickup beat's onset, as a share of the median beat onset
    "tempo_change": 0.04,   # (Task 3) relative tempo change that starts a segment
    "tempo_bars": 4,        # (Task 3) bars a change must last
    "ramp_bars": 2,         # (Task 3) a change spread over more bars than this is a ramp
}
SWING_WINDOW = (0.40, 0.85)  # where in the beat the swung off-beat is looked for
ONSET_SHARE = 0.25           # an off-beat counts when its peak is at least this share of the beat's own peak
SWING_RATIO = 1.5            # the off-beat must be this much stronger than the straight 0.5 position (not 16ths)
THIRDS = (1 / 3, 2 / 3)      # 6/8: each dotted beat divides in three
THIRDS_TOL = 0.06            # how close (fraction of the beat) a peak must be to a third
THIRDS_SHARE = 0.60          # share of beats that must show both thirds
PICKUP_QUIET = 0.10          # the beat before a pickup must be below this share of the median onset
PEAK_FRAMES = 2              # a beat's own peak: the envelope's maximum within +-2 frames


def at(env, fps_env, t):
    """The envelope at time t (seconds, envelope time base): linear interpolation, 0 outside. t may be an array."""
    v = np.interp(np.asarray(t, float) * fps_env, np.arange(len(env)), env, left=0.0, right=0.0)
    return float(v) if np.ndim(v) == 0 else v


def _peak(env, fps_env, t, frames=PEAK_FRAMES):
    """Largest envelope value within +-frames of t (sampled with at())."""
    return float(np.max(at(env, fps_env, t + np.arange(-frames, frames + 1) / fps_env)))


def _intervals(beat_times):
    b = np.asarray(beat_times, float)
    return b[:-1], np.diff(b)


def _offbeat(env, fps_env, b, d, lo, hi):
    """Strongest local maximum of env between fractions lo and hi of the beat [b, b + d): (fraction, value) or None."""
    n = max(3, int(round((hi - lo) * d * fps_env)) + 1)
    fr = np.linspace(lo, hi, n)
    v = at(env, fps_env, b + fr * d)
    best = None
    for k in range(1, n - 1):  # interior local maxima only: a window edge is the tail of a neighbouring onset
        if v[k] >= v[k - 1] and v[k] >= v[k + 1] and (best is None or v[k] > v[best]):
            best = k
    return None if best is None else (float(fr[best]), float(v[best]))


def _swing_on(full_env, fps_env, beat_times):
    """Swing read on one grid: (value, confidence, reason) or None."""
    T = THRESHOLDS
    starts, ds = _intervals(beat_times)
    if len(ds) < 4:
        return None
    fracs = []
    for b, d in zip(starts, ds):
        own = _peak(full_env, fps_env, b)
        ob = _offbeat(full_env, fps_env, b, d, *SWING_WINDOW)
        if own > 0 and ob is not None and ob[1] >= ONSET_SHARE * own:
            fracs.append(ob[0])
    share = len(fracs) / len(ds)
    if share < T["swing_share"]:
        return None
    value = round(float(np.median(fracs)), 2)
    if value < T["swing_min"]:
        return None
    cand = float(np.median([_peak(full_env, fps_env, b + value * d, 1) for b, d in zip(starts, ds)]))
    half = float(np.median([_peak(full_env, fps_env, b + 0.5 * d, 1) for b, d in zip(starts, ds)]))
    three_q = float(np.median([_peak(full_env, fps_env, b + 0.75 * d, 1) for b, d in zip(starts, ds)]))
    ratio = cand / (half + 1e-12)
    if ratio < SWING_RATIO:
        return None
    times = lambda r: "over 10x" if r > 10 else f"{r:.1f}x"
    reason = (f"{share:.0%} of beats have an off-beat at about {value:.2f} of the beat, "
              f"{times(ratio)} stronger than a straight 8th"
              + (f" ({times(cand / (three_q + 1e-12))} the 3/4 position)" if abs(value - 0.75) > THIRDS_TOL else ""))
    return value, round(share * min(1.0, (ratio - 1) / 2), 2), reason


def _comb(full_env, fps_env, beat_times):
    """How well a grid sits on the onsets: the mean envelope at its beats (fit_grid's comb score)."""
    b = np.asarray(beat_times, float)
    return float(np.mean(at(full_env, fps_env, b))) if len(b) else 0.0


def detect_swing(full_env, fps_env, beat_times, bpm, alternatives, refit=None):
    """Swing: the median position of each beat's strongest off-beat onset, when most beats have one, it is late enough,
    and it is clearly stronger than a straight 8th (so 16th-note hats at 1/4, 1/2, 3/4 are not read as swing).
    Triplet correction: a shuffle's triplets can pull the measured tempo to 4/3 of the real one, and on that grid no
    swing shows. So when none is found and `refit(bpm_guess) -> (bpm, beat_times)` is given, a grid is fitted near 3/4
    of the tempo (seeded by an alternative within triplet_tol of it, if any); swing found there, on a grid whose comb
    score is at least triplet_fit x the current grid's, is suggested with that tempo. Swing found on the current grid
    never offers a slower tempo."""
    T = THRESHOLDS
    here = _swing_on(full_env, fps_env, beat_times)
    if here is not None:
        value, confidence, reason = here
        return {"value": value, "confidence": confidence, "reason": reason}
    if refit is None:
        return None
    guess = 0.75 * bpm
    near = [a for a in alternatives if a and abs(a / guess - 1) <= T["triplet_tol"]]
    if near:
        guess = min(near, key=lambda a: abs(a / guess - 1))
    slow_bpm, slow_beats = refit(guess)
    there = _swing_on(full_env, fps_env, slow_beats)
    if there is None:
        return None
    cur, slow = _comb(full_env, fps_env, beat_times), _comb(full_env, fps_env, slow_beats)
    if cur <= 0 or slow < T["triplet_fit"] * cur:
        return None
    value, confidence, _ = there
    slow_bpm = round(float(slow_bpm), 2)
    return {"value": value, "bpm": slow_bpm, "confidence": round(confidence * min(1.0, slow / cur), 2),
            "reason": f"no swing on the {bpm:g} BPM grid, but the shuffle's triplets pull the tempo to 4/3; "
                      f"at {slow_bpm:g} BPM off-beats land at {value:.0%} (that grid fits the onsets "
                      f"{slow / cur:.2f}x as well)"}


def _ac(x, lag):
    x = np.asarray(x, float) - np.mean(x)
    var = float(np.mean(x * x))
    if var <= 0 or lag >= len(x):
        return 0.0
    return float(np.mean(x[:-lag] * x[lag:])) / var


def detect_meter(low_env, full_env, fps_env, beat_times):
    """3/4 when the kick repeats every 3 beats clearly more than every 4; 6/8 when each beat divides in three and the
    kick repeats every 2 (dotted) beats. None for 4/4 (the default)."""
    b = np.asarray(beat_times, float)
    if len(b) < 9:
        return None
    kick = [_peak(low_env, fps_env, t) for t in b]
    ac = {lag: _ac(kick, lag) for lag in (2, 3, 4)}
    diff = ac[3] - ac[4]
    if diff >= THRESHOLDS["meter_margin"]:
        return {"value": "3/4", "confidence": round(min(1.0, diff), 2),
                "reason": f"the kick repeats every 3 beats (autocorrelation {ac[3]:.2f}) more than every 4 ({ac[4]:.2f})"}
    starts, ds = _intervals(b)
    thirds = 0
    for t, d in zip(starts, ds):
        own = _peak(full_env, fps_env, t)
        ok = own > 0
        for f in THIRDS:
            ob = _offbeat(full_env, fps_env, t, d, f - THIRDS_TOL, f + THIRDS_TOL)
            ok = ok and ob is not None and ob[1] >= ONSET_SHARE * own
        thirds += ok
    share = thirds / len(ds)
    if share >= THIRDS_SHARE and ac[2] >= max(ac[3], ac[4]) - 1e-9:
        return {"value": "6/8", "confidence": round(share * min(1.0, max(0.0, ac[2])), 2),
                "reason": f"{share:.0%} of beats divide in three and the kick repeats every 2 beats "
                          f"(autocorrelation {ac[2]:.2f})"}
    return None


def detect_pickup(full_env, fps_env, beat_times, downbeat_index, beats_per_bar):
    """A pickup: grid beats with audible onsets directly before the first downbeat, after silence. downbeat_index is
    the grid's downbeat phase (any downbeat); the first one with an audible onset is used, so leading silence is
    skipped. Counts backwards from it and stops at the first quiet beat."""
    b = np.asarray(beat_times, float)
    if len(b) < 2:
        return None
    onset = np.array([_peak(full_env, fps_env, t) for t in b])
    med = float(np.median(onset))
    if med <= 0:
        return None
    loud = THRESHOLDS["pickup_onset"] * med
    d = int(downbeat_index)
    while d < len(b) and onset[d] < loud:
        d += beats_per_bar
    if d >= len(b):
        return None
    n = 0
    while d - n - 1 >= 0 and onset[d - n - 1] >= loud:
        n += 1
    before = d - n - 1
    if not 1 <= n <= beats_per_bar - 1:
        return None
    if before >= 0 and onset[before] >= PICKUP_QUIET * med:
        return None
    weakest = float(onset[d - n:d].min()) / med
    return {"beats": n, "confidence": round(min(1.0, weakest), 2),
            "reason": f"{n} beat{'s' if n > 1 else ''} with audible onsets come before the first downbeat, "
                      "after silence"}
