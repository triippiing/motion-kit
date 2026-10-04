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


def _onsets(full_env, fps_env, b):
    """Each beat's own onset peak, and their median."""
    onset = np.array([_peak(full_env, fps_env, t) for t in b])
    return onset, float(np.median(onset)) if len(onset) else 0.0


def _first_loud_downbeat(onset, loud, downbeat_index, beats_per_bar):
    d = int(downbeat_index)
    while d < len(onset) and onset[d] < loud:
        d += beats_per_bar
    return d if d < len(onset) else None


def first_downbeat(full_env, fps_env, beat_times, downbeat_index, beats_per_bar):
    """The index of the first downbeat (downbeat_index + k x beats_per_bar) with an audible onset (at least
    pickup_onset x the median beat onset): where the song's first bar starts, the downbeat detect_pickup counts back
    from. None when there is none."""
    b = np.asarray(beat_times, float)
    if not len(b):
        return None
    onset, med = _onsets(full_env, fps_env, b)
    if med <= 0:
        return None
    return _first_loud_downbeat(onset, THRESHOLDS["pickup_onset"] * med, downbeat_index, beats_per_bar)


def detect_pickup(full_env, fps_env, beat_times, downbeat_index, beats_per_bar):
    """A pickup: grid beats with audible onsets directly before the first downbeat, after silence. downbeat_index is
    the grid's downbeat phase (any downbeat); the first one with an audible onset is used, so leading silence is
    skipped. Counts backwards from it and stops at the first quiet beat."""
    b = np.asarray(beat_times, float)
    if len(b) < 2:
        return None
    onset, med = _onsets(full_env, fps_env, b)
    if med <= 0:
        return None
    loud = THRESHOLDS["pickup_onset"] * med
    d = _first_loud_downbeat(onset, loud, downbeat_index, beats_per_bar)
    if d is None:
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


REGULAR_TOL = 0.05   # (confidence) a tracked beat gap counts as regular within 5% of its span's beat period
OCTAVE_TOL = 0.06    # two tempos within 6% of 2:1 are taken as one tempo read an octave apart


def _octave_step(x, ref):
    """+1 / -1 when x is about 2x / 0.5x ref (within OCTAVE_TOL), else 0."""
    r = np.log2(x / ref)
    for k in (1, -1):
        if abs(r - k) <= np.log2(1 + OCTAVE_TOL):
            return k
    return 0


def local_tempo(full_env, fps_env, global_bpm, tempo_candidates, win_sec=8.0, hop_sec=2.0):
    """Per window (win_sec long, every hop_sec): (window centre in envelope seconds, bpm). Each window takes its
    strongest candidate (tempo_candidates is analyze_song's, passed in; among candidates whose autocorrelation is at
    least LOCAL_STRONG x the window's best, the top of the analyser's own ranking). Octave errors are then resolved by
    continuity, never by folding to the global tempo (which would misread any change bigger than x sqrt(2)):
    1. a window about 2:1 from the median of its neighbours (+-2 windows) is folded to their octave;
    2. walking forward, a window about 2:1 from the previous one is folded to its octave (a whole run read an octave
       out follows the song before it);
    3. the whole curve moves by the octave (x2, 1, /2) that puts most windows within 6% of global_bpm, so a steady song
       read at double tempo reports the global tempo's octave (Review Focus 2).
    Non-octave ratios (1.5, 1.33, ...) are kept as real changes; a true exact 2:1 change reads as steady (accepted).
    Windows with no candidate are skipped."""
    win, hop = int(round(win_sec * fps_env)), max(1, int(round(hop_sec * fps_env)))
    ts, xs = [], []
    for a in range(0, len(full_env) - win + 1, hop):
        cands = tempo_candidates(np.asarray(full_env[a:a + win], float))
        if not cands:
            continue
        top = max(c[1] for c in cands)
        best = max((c for c in cands if c[1] >= LOCAL_STRONG * top), key=lambda c: c[2])
        ts.append((a + win / 2) / fps_env)
        xs.append(float(best[0]))
    x = np.array(xs)
    for i in range(len(x)):
        nb = np.concatenate([x[max(0, i - 2):i], x[i + 1:i + 3]])
        if len(nb):
            x[i] /= 2.0 ** _octave_step(x[i], float(np.median(nb)))
    for i in range(1, len(x)):
        x[i] /= 2.0 ** _octave_step(x[i], x[i - 1])
    if len(x):
        near = lambda m: int(np.sum(np.abs(x * 2.0 ** m / global_bpm - 1) <= OCTAVE_TOL))
        m = max((0, 1, -1), key=near)  # ties keep the octave read
        x = x * 2.0 ** m
    return [(t, float(v)) for t, v in zip(ts, x)]


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
    # the first segment's tempo is seeded from its first tempo_bars bars, so one odd opening bar is not a segment
    seed = float(np.median(sm[:tb]))
    first = [q for q in range(min(tb, nbars)) if off(sm[q], seed) <= tol] or list(range(min(tb, nbars)))
    segs = [{"steady": first, "anchors": [{"t": 0.0, "ramp": False}]}]
    k = min(tb, nbars)
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


def _map_confidence(full_env, fps_env, env_beats, segments, curve, time_offset, win_sec):
    """Confidence of a tempo map, from evidence the segmentation itself does not use (0..1):
        confidence = min over steady spans of salience  x  window agreement
    - a steady span runs from an anchor to the next one (not into a ramp), the last to the end;
    - salience of a span = contrast x regularity, where contrast = clip(1 - mean(env over the span's frames) /
      mean(env at its tracked beats), 0, 1) (about 0.93 for clean clicks; lower when the beats stand out less from
      everything else) and regularity = share of the span's tracked beat gaps within REGULAR_TOL of 60 / bpm (the DP
      snaps to noise peaks, which lifts contrast on noise, but then its gaps are irregular);
    - window agreement = share of the local-tempo windows lying wholly inside a steady span whose bpm is within
      tempo_change of that span's tempo (0.5, neutral, when no window fits inside any span).
    env_beats are in envelope seconds; segments' t in song seconds (env time + time_offset)."""
    env = np.asarray(full_env, float)
    T = THRESHOLDS
    end = len(env) / fps_env + time_offset
    spans = []
    for i, a in enumerate(segments):
        nxt = segments[i + 1] if i + 1 < len(segments) else None
        if nxt is not None and nxt["ramp"]:
            continue
        spans.append((a["t"], nxt["t"] if nxt else end, a["bpm"]))
    sal, agree, n_win = [], 0, 0
    song_beats = env_beats + time_offset
    for t0, t1, bpm in spans:
        inb = env_beats[(song_beats >= t0) & (song_beats < t1)]
        f0, f1 = int(max(0.0, t0 - time_offset) * fps_env), int(max(0.0, t1 - time_offset) * fps_env)
        if len(inb) and f1 > f0:
            on = float(np.mean(at(env, fps_env, inb)))
            contrast = float(np.clip(1 - float(np.mean(env[f0:f1])) / on, 0, 1)) if on > 0 else 0.0
            gaps = np.diff(inb)
            steady = float(np.mean(np.abs(gaps * bpm / 60 - 1) <= REGULAR_TOL)) if len(gaps) else 0.0
            sal.append(contrast * steady)
        for c, b in curve:
            if t0 <= c - win_sec / 2 + time_offset and c + win_sec / 2 + time_offset <= t1:
                n_win += 1
                agree += abs(b / bpm - 1) <= T["tempo_change"]
    salience = min(sal) if sal else 0.0
    return round(salience * (agree / n_win if n_win else 0.5), 2)


def _refine_steps(full_env, fps_env, env_beats, segments, beats_per_bar, time_offset):
    """Steps re-placed from the onsets: from a tracked beat a bar before the anchor, the old tempo's grid is run on
    (up to two bars past the anchor) while it keeps landing on onsets (the envelope at least half the median at the
    old segment's tracked beats); the step moves to the last grid beat that does. Ramps are left alone.
    env_beats in envelope seconds; segments' t in song seconds."""
    env = np.asarray(full_env, float)
    out = [dict(a) for a in segments]
    song = env_beats + time_offset
    for i in range(1, len(out)):
        a, prev = out[i], out[i - 1]
        if a["ramp"] or (i + 1 < len(out) and out[i + 1]["ramp"]):
            continue
        p0 = 60.0 / prev["bpm"]
        old = env_beats[(song >= prev["t"]) & (song <= a["t"] - beats_per_bar * p0)]
        if len(old) < 2:
            continue
        loud = 0.5 * float(np.median(at(env, fps_env, old)))
        r = old[-1]
        k = 0
        while r + (k + 1) * p0 + time_offset <= a["t"] + 2 * beats_per_bar * p0 \
                and _peak(env, fps_env, r + (k + 1) * p0, 1) >= loud:
            k += 1
        t = r + k * p0 + time_offset
        if t > prev["t"]:
            a["t"] = round(float(t), 3)
    return out


def _map_curve(segments, time_offset):
    """A tempo curve [(envelope seconds, bpm)] that follows a map: constant between anchors, a step at a plain anchor,
    linear into a ramp anchor (the shape click_track and the sync grid use)."""
    pts = []
    for i, a in enumerate(segments):
        t = a["t"] - time_offset
        if i and not a["ramp"]:
            pts.append((t - 1e-3, segments[i - 1]["bpm"]))
        pts.append((t, a["bpm"]))
    return pts


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
    segments, _ = _segments(beats, beats_per_bar)
    if len(segments) < 2:
        return None
    # Windows straddling a step read the new tempo up to half a window early, and the tracker can invent beats there.
    # So each step is re-placed from the onsets (the old grid run on until it stops landing on onsets), and the beats
    # are tracked again with the map itself as the tempo prior; the segments come from that second pass.
    segments = _refine_steps(full_env, fps_env, beats - time_offset, segments, beats_per_bar, time_offset)
    beats = track_beats(full_env, fps_env, _map_curve(segments, time_offset)) + time_offset
    segments, _ = _segments(beats, beats_per_bar)
    if len(segments) < 2:
        return None
    confidence = _map_confidence(full_env, fps_env, beats - time_offset, segments, curve, time_offset, win_sec)
    moves = []
    for prev, a in zip(segments, segments[1:]):
        if a["ramp"]:
            moves.append(f"ramps from {prev['bpm']:g} to {a['bpm']:g} BPM between {_clock(prev['t'])} and "
                         f"{_clock(a['t'])}")
        elif a["bpm"] != prev["bpm"]:
            moves.append(f"changes from {prev['bpm']:g} to {a['bpm']:g} BPM at {_clock(a['t'])}")
    return {"segments": segments, "beats": [round(float(x), 3) for x in beats], "confidence": confidence,
            "reason": "the tempo " + "; then ".join(moves)}


MAP_EDGE = 0.15   # (map_grid) how far, in beats, a span's grid may run past its end anchor


def map_grid(full_env, fps_env, segments, time_offset):
    """The beat grid of a user's tempo map (sync.tempo_map: [{t song seconds, bpm, ramp}], first t 0): beats are tracked
    with the map as the tracker's tempo prior (track_beats), then each span between anchors is laid exactly at the
    map's tempo (constant, or linear into a ramp anchor) with its phase fitted to the tracked beats in it (a circular
    mean weighted by the onset at each beat, so beats tracked through silence count for little). A span with no
    tracked beat keeps the previous span's phase. At a junction a span's grid may run MAP_EDGE of a beat past its end
    anchor, and a beat of the next span within half a beat of the previous beat is dropped, so an anchor set on (or a
    few ms either side of) the last beat at the old tempo gives that beat, not an extra one. Returns beat times in the envelope's own time base (frame index /
    fps_env), like track_beats; the analyser adds its ENV_TIME_OFFSET (and the user's nudge) for song seconds."""
    env = np.asarray(full_env, float)
    segs = [{"t": float(a["t"]), "bpm": float(a["bpm"]), "ramp": bool(a.get("ramp", False))} for a in segments]
    dur = len(env) / fps_env
    tracked = track_beats(env, fps_env, _map_curve(segs, time_offset))
    # beats elapsed (the map's tempo integrated) on a 1 ms grid of envelope time; inverted by interpolation
    tau = np.arange(0.0, dur + 1e-3, 1e-3)
    starts = np.array([a["t"] - time_offset for a in segs])
    k = np.clip(np.searchsorted(starts, tau, side="right") - 1, 0, len(segs) - 1)
    bpm = np.array([a["bpm"] for a in segs])
    nxt = np.minimum(k + 1, len(segs) - 1)
    ramp = np.array([a["ramp"] for a in segs])[nxt] & (nxt > k)
    frac = np.where(ramp, (tau - starts[k]) / np.maximum(starts[nxt] - starts[k], 1e-9), 0.0)
    tempo = bpm[k] + np.where(ramp, (bpm[nxt] - bpm[k]) * frac, 0.0)
    phi = np.concatenate([[0.0], np.cumsum((tempo[1:] + tempo[:-1]) / 2 * np.diff(tau) / 60.0)])
    w = at(env, fps_env, tracked) + 1e-9
    beats, phase = [], 0.0
    bounds = list(np.clip(starts, 0.0, dur)) + [dur]
    bounds[0] = 0.0
    for i in range(len(segs)):
        lo, hi = bounds[i], bounds[i + 1]
        if hi <= lo:
            continue
        inside = (tracked >= lo) & (tracked < hi)
        if inside.any():
            ang = 2 * np.pi * np.interp(tracked[inside], tau, phi)
            phase = float(np.angle(np.sum(w[inside] * np.exp(1j * ang))) / (2 * np.pi)) % 1.0
        # a span's grid may run MAP_EDGE of a beat past its end (an anchor placed on its last beat, give or take the
        # tracker's jitter); the next span's beats closer than half a beat to the one before are dropped
        end = min(dur, hi + MAP_EDGE * 60.0 / float(np.interp(hi, tau, tempo)))
        p_lo, p_end = np.interp(lo, tau, phi), np.interp(end, tau, phi)
        ks = np.arange(np.ceil(p_lo - phase), np.ceil(p_end - phase))
        for t in np.interp(ks + phase, phi, tau):
            if t < end and (not beats or t - beats[-1] >= 0.5 * 60.0 / np.interp(t, tau, tempo)):
                beats.append(float(t))
    return np.array(beats)


SWING_SAME = 0.02   # a kept swing within this of the suggestion counts as the same (no suggestion)
SUGGESTION_KEYS = ("tempo_map", "swing", "meter", "pickup")


def suggestion_value(key, suggestion):
    """What a dismissal records for a suggestion (sync.dismissed [{key, value}]): it stays hidden while this is equal."""
    return suggestion["segments"] if key == "tempo_map" else suggestion["beats"] if key == "pickup" \
        else suggestion["value"]


def suggest(full_env, low_env, fps_env, beat_times, bpm, alternatives, downbeat_index, beats_per_bar, sync=None, *,
            tempo_candidates, refit, time_offset):
    """The analyser's `suggestions`: the four detectors on the grid in use (beat_times in envelope time), keeping only
    what differs from that grid (no tempo map when sync has one; no meter equal to sync's; no swing within SWING_SAME
    of sync's; no pickup equal to sync's pickup_beats) and is not in sync.dismissed with the same value. Swing is not
    suggested when the meter is (or is suggested as) 6/8: its thirds read as swing. A tempo-map suggestion (not
    dismissed) is offered alone: meter, swing and pickup would be measured on the single grid it says is wrong.
    Returns {key: suggestion}."""
    s = sync or {}
    hidden = lambda key, sug: any(d["key"] == key and suggestion_value(key, sug) == d["value"]
                                  for d in s.get("dismissed", []))
    if s.get("tempo_map") is None:
        tm = detect_tempo_map(full_env, fps_env, bpm, beats_per_bar, tempo_candidates, time_offset=time_offset)
        if tm is not None and not hidden("tempo_map", tm):
            # the single grid the others would be measured on is the one the map says is wrong: they wait until the
            # map is kept (then they run on its grid) or dismissed
            return {"tempo_map": tm}
    out = {}
    meter = detect_meter(low_env, full_env, fps_env, beat_times)
    if meter is not None and meter["value"] != s.get("meter", "4/4"):
        out["meter"] = meter
    if "6/8" not in (s.get("meter"), meter and meter["value"]):
        # on a tempo-mapped grid a single slower tempo could not be kept (the map replaces bpm): no triplet re-fit
        sw = detect_swing(full_env, fps_env, beat_times, bpm, alternatives,
                          refit=None if s.get("tempo_map") is not None else refit)
        if sw is not None:
            kept = abs(sw["value"] - s.get("swing", 0.5)) <= SWING_SAME + 1e-9 and (
                "bpm" not in sw or (s.get("bpm") is not None and abs(s["bpm"] - sw["bpm"]) <= 0.5))
            if not kept:
                out["swing"] = sw
    pk = detect_pickup(full_env, fps_env, beat_times, downbeat_index, beats_per_bar)
    if pk is not None and pk["beats"] != s.get("pickup_beats", 0):
        out["pickup"] = pk
    return {k: v for k, v in out.items() if not hidden(k, v)}
