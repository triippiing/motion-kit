#!/usr/bin/env python3
"""song_suggest.py -- detectors behind the analyser's `suggestions` (C2b): swing (with a triplet tempo correction),
meter (3/4, 6/8), a pickup before the first downbeat, and tempo maps (steps and ramps).

Suggestions only: these functions never decide anything. Each returns a proposal (with a confidence 0..1 and a one-line
reason) or None; only the user's `sync` (Keep + Save on the sync page) ever changes the grid.

They take numpy arrays and plain numbers, never a path, so this module does not import analyze_song (which imports it).
Time base: `beat_times` are in the envelopes' own time base, frame index / fps_env (analyze_song.beat_grid's
`pos / FPS_ENV`), so an onset sits exactly on its beat. Swing, meter and pickup return no time; the tempo map returns
song seconds (see its section below: detect_tempo_map adds the analyser's ENV_TIME_OFFSET, passed in as time_offset).
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


# ---- Tempo maps (Task 3) ----------------------------------------------------------------------------------------------
# Time bases: local_tempo and track_beats work in the envelope's own time base (frame index / fps_env). segment_tempo
# reports times in whatever base its beat_times use. detect_tempo_map adds `time_offset` (the analyser's
# ENV_TIME_OFFSET) so its `beats` and segment `t` are SONG seconds, the times the sync page plays clicks at.
LOCAL_STRONG = 0.5   # a window's tempo candidates considered: autocorrelation at least this share of its best one


def _fold(bpm, global_bpm):
    """bpm moved by octaves (x2 / /2) to within x sqrt(2) of global_bpm."""
    return float(bpm * 2.0 ** np.round(np.log2(global_bpm / bpm)))


def local_tempo(full_env, fps_env, global_bpm, tempo_candidates, win_sec=8.0, hop_sec=2.0):
    """Per window (win_sec long, every hop_sec): (window centre in envelope seconds, bpm). The bpm is the window's
    strong tempo candidate (tempo_candidates is analyze_song's, passed in) nearest the global tempo's octave family,
    folded to within x sqrt(2) of global_bpm, so a steady song read at double tempo stays steady (Review Focus 2).
    Windows with no candidate are skipped."""
    win, hop = int(round(win_sec * fps_env)), max(1, int(round(hop_sec * fps_env)))
    out = []
    for a in range(0, len(full_env) - win + 1, hop):
        cands = tempo_candidates(np.asarray(full_env[a:a + win], float))
        if not cands:
            continue
        top = max(c[1] for c in cands)
        strong = [c for c in cands if c[1] >= LOCAL_STRONG * top]
        best = min(strong, key=lambda c: (round(abs(np.log2(_fold(c[0], global_bpm) / global_bpm)), 6), -c[1]))
        out.append(((a + win / 2) / fps_env, _fold(best[0], global_bpm)))
    return out


def track_beats(full_env, fps_env, tempo_curve, tightness=100.0):
    """Ellis (2007) dynamic-programming beat tracker. score[t] = env[t] + max_p (score[p] - tightness *
    log((t - p) / period(t))^2) over p in [t - 2 period, t - period / 2] (a chain restarts when that max is not
    positive); the best frame in the last period is backtraced. period(t) comes from tempo_curve [(envelope seconds,
    bpm)], linearly interpolated (held at the ends). env is scaled to unit standard deviation. Returns beat times in
    the envelope's own time base (frame index / fps_env), refined to a fraction of a frame at the envelope's peak."""
    env = np.asarray(full_env, float)
    n = len(env)
    if n == 0 or not tempo_curve:
        return np.zeros(0)
    e = env / (env.std() + 1e-12)
    tc = np.array([c[0] for c in tempo_curve], float) * fps_env
    bc = np.array([c[1] for c in tempo_curve], float)
    period = 60.0 * fps_env / np.interp(np.arange(n), tc, bc)
    score = e.copy()
    back = np.full(n, -1)
    for t in range(n):
        P = period[t]
        hi = t - int(round(P / 2))
        if hi < 0:
            continue
        lo = max(0, t - int(round(2 * P)))
        ps = np.arange(lo, hi + 1)
        vals = score[lo:hi + 1] - tightness * np.log((t - ps) / P) ** 2
        k = int(np.argmax(vals))
        if vals[k] > 0:
            score[t] = e[t] + vals[k]
            back[t] = ps[k]
    last = max(0, n - int(round(period[-1])))
    t = last + int(np.argmax(score[last:]))
    beats = []
    while t >= 0:
        beats.append(t)
        t = back[t]
    beats = np.array(beats[::-1], float)
    # sub-frame: a parabola through the envelope around each beat frame
    i = beats.astype(int)
    ok = (i > 0) & (i < n - 1)
    y0, y1, y2 = env[i[ok] - 1], env[i[ok]], env[i[ok] + 1]
    den = y0 - 2 * y1 + y2
    d = np.where((den < 0) & (y1 >= y0) & (y1 >= y2), 0.5 * (y0 - y2) / np.where(den == 0, 1, den), 0.0)
    beats[ok] += np.clip(d, -0.5, 0.5)
    return beats / fps_env


def _segments(beat_times, beats_per_bar):
    """segment_tempo's work: (anchors, share of steady bars within tempo_change of their segment's tempo)."""
    T = THRESHOLDS
    tol, tb = T["tempo_change"], int(T["tempo_bars"])
    b = np.asarray(beat_times, float)
    gaps = np.diff(b)
    nbars = len(gaps) // beats_per_bar
    if nbars < 1:
        return ([{"t": 0.0, "bpm": round(60.0 / float(np.median(gaps)), 2), "ramp": False}] if len(gaps) else []), 0.0
    bar_gaps = gaps[:nbars * beats_per_bar].reshape(nbars, beats_per_bar)
    raw = 60.0 / np.median(bar_gaps, axis=1)
    sm = raw.copy()
    for k in range(1, nbars - 1):  # median over 3 bars: keeps a step a step
        sm[k] = np.median(raw[k - 1:k + 2])
    bar_t = b[np.arange(nbars + 1) * beats_per_bar]
    off = lambda x, ref: abs(x / ref - 1)
    segs = [{"steady": [0], "anchors": [{"t": 0.0, "ramp": False}]}]
    k = 1
    while k < nbars:
        cur = segs[-1]["steady"]
        ref = float(np.median(sm[cur]))
        if off(sm[k], ref) <= tol:
            cur.append(k)
            k += 1
            continue
        j = k
        while j < nbars and off(sm[j], ref) > tol:
            j += 1
        if j - k < tb:  # a short excursion (a fill, a stumble): not a tempo change
            k = j
            continue
        settle = None  # the first run of tempo_bars bars at one new tempo
        for s in range(k, nbars - tb + 1):
            w = sm[s:s + tb]
            m = float(np.median(w))
            if all(off(x, m) <= tol / 2 for x in w) and off(m, ref) > tol:
                settle, new = s, m
                break
        if settle is None:  # still moving at the end of the song: nothing to anchor
            break
        m0 = k - 1  # the last bar still at the old tempo
        for q in range(settle - 1, k - 2, -1):
            if off(sm[q], ref) <= tol / 2:
                m0 = q
                break
        if settle - m0 - 1 > T["ramp_bars"]:
            # tempo is linear in time on a ramp: a line through the moving bars, met with the old and new tempos
            mid = (bar_t[:-1] + bar_t[1:]) / 2
            q = np.arange(m0 + 1, settle)
            slope, icept = np.polyfit(mid[q], raw[q], 1)
            t0, t1 = float(bar_t[m0 + 1]), float(bar_t[settle])
            if slope != 0:
                t0 = float(np.clip((ref - icept) / slope, bar_t[m0], bar_t[m0 + 1]))
                t1 = float(np.clip((new - icept) / slope, bar_t[settle], bar_t[settle + 1]))
            anchors = [{"t": t0, "ramp": False, "same_as_previous": True}, {"t": t1, "ramp": True}]
        else:
            # a step: the first beat (from the first moving bar) whose gap is nearer the new tempo than the old
            first = (m0 + 1) * beats_per_bar
            last = settle * beats_per_bar
            t = bar_t[settle]
            for i in range(first, last + 1):
                if abs(np.log(gaps[i] * new / 60)) < abs(np.log(gaps[i] * ref / 60)):
                    t = b[i]
                    break
            anchors = [{"t": float(t), "ramp": False}]
        segs.append({"steady": list(range(settle, settle + tb)), "anchors": anchors})
        k = settle + tb
    out, steady_ok, steady_n = [], 0, 0
    for seg in segs:
        bpm = 60.0 / float(np.median(bar_gaps[seg["steady"]]))
        steady_ok += sum(off(raw[q], bpm) <= tol for q in seg["steady"])
        steady_n += len(seg["steady"])
        for a in seg["anchors"]:
            same = a.pop("same_as_previous", False)
            out.append({"t": round(a["t"], 3), "bpm": out[-1]["bpm"] if same else round(bpm, 2), "ramp": a["ramp"]})
    return out, steady_ok / max(1, steady_n)


def segment_tempo(beat_times, beats_per_bar):
    """Tempo anchors [{t, bpm, ramp}] from beat times (bars counted from the first beat). Per-bar tempo is the median
    of the bar's inter-beat gaps, smoothed by a median over 3 bars. A new segment starts where the tempo differs from
    the running segment's by more than tempo_change for at least tempo_bars bars and then holds (tempo_bars bars within
    half of tempo_change of each other). A move spread over more than ramp_bars bars is a ramp: an anchor at its start
    (the old tempo) and one at its end with ramp True; otherwise a step anchored at the first beat of the new tempo.
    The first anchor is at t 0; later t are in beat_times' own time base; bpm is the median over the steady bars."""
    return _segments(beat_times, beats_per_bar)[0]


def _clock(t):
    return f"{int(t // 60)}:{t % 60:04.1f}"


def detect_tempo_map(full_env, fps_env, global_bpm, beats_per_bar, tempo_candidates, *, time_offset,
                     win_sec=8.0, hop_sec=2.0):
    """A tempo-map suggestion: local tempo -> DP beats -> segments; suggested when there are at least two anchors.
    time_offset (required: the analyser's ENV_TIME_OFFSET) turns envelope time into song seconds, so `beats` and the
    segments' `t` are song seconds. None for a song shorter than two windows (Review Focus 5) or a steady one."""
    if len(full_env) < 2 * win_sec * fps_env:
        return None
    curve = local_tempo(full_env, fps_env, global_bpm, tempo_candidates, win_sec, hop_sec)
    if not curve:
        return None
    beats = track_beats(full_env, fps_env, curve) + time_offset
    segments, share = _segments(beats, beats_per_bar)
    if len(segments) < 2:
        return None
    moves = []
    for prev, a in zip(segments, segments[1:]):
        if a["ramp"]:
            moves.append(f"ramps from {prev['bpm']:g} to {a['bpm']:g} BPM between {_clock(prev['t'])} and "
                         f"{_clock(a['t'])}")
        elif a["bpm"] != prev["bpm"]:
            moves.append(f"changes from {prev['bpm']:g} to {a['bpm']:g} BPM at {_clock(a['t'])}")
    return {"segments": segments, "beats": [round(float(x), 3) for x in beats], "confidence": round(float(share), 2),
            "reason": "the tempo " + "; then ".join(moves)}
