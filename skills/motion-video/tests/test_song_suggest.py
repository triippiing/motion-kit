import shutil
import sys
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
import analyze_song as A  # noqa: E402
import song_suggest as S  # noqa: E402
from click_track import beat_times, click_track  # noqa: E402


def _read(path):
    with wave.open(str(path)) as w:
        return w.getparams(), np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float64)


def _write(path, x, sr=44100):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())
    return path


def band_shuffle(path, bpm=110, swing=0.66, seconds=30.0, hat=0.02, sr=44100, seed=0):
    """A loud straight band (a 55 Hz kick on every beat, a low-passed noise snare on 2 and 4) with the swing carried
    only by a quiet high-passed hi-hat on each beat and at beat + swing x beat: on a real mix the off-beat is a hat or
    a ghost note, masked in the full band by the kick and snare."""
    rng = np.random.default_rng(seed)
    x = np.zeros(int(seconds * sr))
    n, m = int(0.05 * sr), int(0.2 * sr)
    tt, tk = np.arange(n) / sr, np.arange(m) / sr
    kick = 0.9 * np.exp(-tk * 18) * np.sin(2 * np.pi * 55 * tk)

    def add(t, sig):
        s = int(t * sr)
        k = min(len(sig), len(x) - s)
        x[s:s + k] += sig[:k]
    beat, t, i = 60.0 / bpm, 0.37, 0
    while t < seconds - 0.5:
        add(t, kick)
        if i % 2:
            add(t, 0.8 * np.exp(-tt * 40) * 4 * np.convolve(rng.standard_normal(n + 15), np.ones(16) / 16, "valid"))
        for f in (0.0, swing):
            add(t + f * beat, hat * np.exp(-tt * 150) * np.diff(rng.standard_normal(n + 1)))
        t, i = t + beat, i + 1
    return _write(path, x + 0.001 * rng.standard_normal(len(x)), sr)


class SwingMeterPickup(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def track(self, mix_sixteenths=False, force_bpm=None, **kw):
        """A 30 s click_track, its envelopes and the analyser's full-song grid, in the envelope's own time base
        (frame index / FPS_ENV), which is what song_suggest samples."""
        path = self.tmp / "t.wav"
        click_track(path, seconds=30.0, **kw)
        if mix_sixteenths:
            # a quieter straight hat at 4 x bpm (onsets at 0, 1/4, 1/2, 3/4 of each beat), mixed in with numpy
            extra = click_track(self.tmp / "x.wav", 4 * kw["bpm"], seconds=30.0, offset=kw.get("offset", 0.37),
                                hat=0.12, seed=7)
            params, a = _read(path)
            _, b = _read(extra)
            pcm = np.clip(a + b, -32768, 32767).astype("<i2")
            with wave.open(str(path), "wb") as w:
                w.setparams(params)
                w.writeframes(pcm.tobytes())
        sync = {"bpm": force_bpm} if force_bpm is not None else None
        song = A.analyze(path, bars=2, sync=sync)
        full, low, _, self.high = A.envelopes(A.decode(path))
        self.grid = A.beat_grid(full, low, sync)
        self.assertEqual(self.grid["bpm"], song["bpm"])
        return full, low, self.grid["pos"] / A.FPS_ENV, song

    def downbeat(self, song):
        return self.grid["j"]

    def test_straight_track_gets_nothing(self):
        full, low, beats, song = self.track(bpm=120)
        self.assertIsNone(S.detect_swing(full, A.FPS_ENV, beats, song["bpm"], song["alternatives"]))
        self.assertIsNone(S.detect_meter(low, full, A.FPS_ENV, beats))
        self.assertIsNone(S.detect_pickup(full, A.FPS_ENV, beats, self.downbeat(song), 4))

    def test_sixteenth_hats_are_not_swing(self):
        full, low, beats, song = self.track(bpm=110, mix_sixteenths=True)
        self.assertIsNone(S.detect_swing(full, A.FPS_ENV, beats, song["bpm"], song["alternatives"]))

    def test_swing_062_is_found(self):
        full, low, beats, song = self.track(bpm=110, swing=0.62)
        r = S.detect_swing(full, A.FPS_ENV, beats, song["bpm"], song["alternatives"])
        self.assertLessEqual(abs(r["value"] - 0.62), 0.03)
        self.assertEqual(set(r) - {"bpm"}, {"value", "confidence", "reason"})
        self.assertTrue(0 <= r["confidence"] <= 1)

    def test_swing_carried_by_a_quiet_hat_is_read_on_the_high_band(self):   # Task 7, problem B
        path = band_shuffle(self.tmp / "band.wav")
        full, low, _, high = A.envelopes(A.decode(path))
        g = A.beat_grid(full, low)
        beats = g["pos"] / A.FPS_ENV
        self.assertLess(abs(g["bpm"] - 110), 0.5)
        # the full band alone misses it: the kick and snare mask the hat
        self.assertIsNone(S.detect_swing(full, A.FPS_ENV, beats, g["bpm"], g["alternatives"]))
        r = S.detect_swing(full, A.FPS_ENV, beats, g["bpm"], g["alternatives"], high_env=high)
        self.assertIsNotNone(r)
        self.assertLessEqual(abs(r["value"] - 0.66), 0.03)
        self.assertNotIn("bpm", r)
        sug = A.analyze(path, bars=2)["suggestions"]   # the analyser passes its high band
        self.assertLessEqual(abs(sug["swing"]["value"] - 0.66), 0.03, sug)

    def test_a_near_silent_high_band_falls_back_to_the_full_band(self):
        full, low, beats, song = self.track(bpm=110, swing=0.62)
        r = S.detect_swing(full, A.FPS_ENV, beats, song["bpm"], song["alternatives"], high_env=np.zeros_like(full))
        self.assertLessEqual(abs(r["value"] - 0.62), 0.03)

    def test_beats_without_an_onset_are_not_evidence_against_swing(self):
        # a shuffle that drops out every other 2 s (breaks, rests): the beats in the gaps have no onset of their own
        path = click_track(self.tmp / "s.wav", 110, seconds=30.0, swing=0.66)
        params, x = _read(path)
        sr = params.framerate
        for k in range(1, 15, 2):
            x[k * 2 * sr:(k + 1) * 2 * sr] = 0
        full, low, _, high = A.envelopes(A.decode(_write(self.tmp / "gaps.wav", x / 32768, sr)))
        g = A.beat_grid(full, low, {"bpm": 110})
        r = S.detect_swing(full, A.FPS_ENV, g["pos"] / A.FPS_ENV, g["bpm"], g["alternatives"], high_env=high)
        self.assertIsNotNone(r)
        self.assertLessEqual(abs(r["value"] - 0.66), 0.03)

    def test_scattered_off_beats_are_not_swing(self):   # Task 7 fix round 1
        # a straight 150 click with sparse sections and one off-beat hat per beat jittered over 0.6, 0.7, 0.8 of the
        # beat: the median (0.7) looks swung and is clear of 0.5, but only a third of the off-beats sit near it
        path = click_track(self.tmp / "s.wav", 150, seconds=30.0)
        params, x = _read(path)
        sr, beat = params.framerate, 0.4
        x = x / 32768
        n = int(0.04 * sr)
        rng = np.random.default_rng(1)
        for i, t in enumerate(beat_times(150, 30.0)[:-1]):
            s = int((t + (0.6, 0.7, 0.8)[i % 3] * beat) * sr)
            x[s:s + n] += 0.18 * np.exp(-np.arange(n) / sr * 120) * rng.standard_normal(n)
        for k in range(1, 15, 4):
            x[k * 2 * sr:(k + 1) * 2 * sr] = 0
        full, low, _, high = A.envelopes(A.decode(_write(self.tmp / "scattered.wav", x, sr)))
        g = A.beat_grid(full, low)
        self.assertLess(abs(g["bpm"] - 150), 0.5)
        self.assertIsNone(S.detect_swing(full, A.FPS_ENV, g["pos"] / A.FPS_ENV, g["bpm"], g["alternatives"],
                                         refit=self.refit(full), high_env=high))

    def refit(self, full):
        return lambda bpm: A.refit_beats(full, bpm)

    def test_shuffle_read_at_its_tempo_gets_swing_and_no_slower_tempo(self):
        # 96 is 4/3 of the 72.05 alternative here: swing found on the current grid must never offer a slower tempo
        full, low, beats, song = self.track(bpm=96, swing=0.667)
        r = S.detect_swing(full, A.FPS_ENV, beats, song["bpm"], song["alternatives"], refit=self.refit(full))
        self.assertLessEqual(abs(r["value"] - 0.667), 0.03)
        self.assertNotIn("bpm", r)

    def test_triplet_tempo_correction(self):
        # the same shuffle on a 128 grid (4/3 of 96): no swing there, so a grid at 3/4 of the tempo is fitted and the
        # swing found on it is suggested with that tempo
        full, low, beats, song = self.track(bpm=96, swing=0.667, force_bpm=128.0)
        r = S.detect_swing(full, A.FPS_ENV, beats, song["bpm"], song["alternatives"], refit=self.refit(full))
        self.assertLessEqual(abs(r["bpm"] - 96.0), 2.0)
        self.assertLessEqual(abs(r["value"] - 0.667), 0.03)
        self.assertIn("4/3", r["reason"])

    def test_refit_finds_nothing_on_straight_or_sixteenth_tracks(self):
        for kw in (dict(bpm=120), dict(bpm=110, mix_sixteenths=True)):
            with self.subTest(**kw):
                full, low, beats, song = self.track(**kw)
                self.assertIsNone(S.detect_swing(full, A.FPS_ENV, beats, song["bpm"], song["alternatives"],
                                                 refit=self.refit(full)))

    def test_three_four(self):
        full, low, beats, song = self.track(bpm=150, meter="3/4")
        self.assertEqual(S.detect_meter(low, full, A.FPS_ENV, beats)["value"], "3/4")

    def test_six_eight(self):
        # analysed at 60: unforced, the thirds hats pull the tempo to 90 (alternatives 179.87, 60.01), on which grid the
        # kick repeats every 3 beats and 3/4 is the right reading; meter detection presupposes the right tempo
        full, low, beats, song = self.track(bpm=60, meter="6/8", force_bpm=60.0)
        self.assertEqual(S.detect_meter(low, full, A.FPS_ENV, beats)["value"], "6/8")

    def test_pickup_two(self):
        full, low, beats, song = self.track(bpm=100, pickup=2, offset=0.5)
        self.assertEqual(S.detect_pickup(full, A.FPS_ENV, beats, self.downbeat(song), 4)["beats"], 2)

    def test_a_silent_downbeat_after_a_pickup_is_still_the_first_downbeat(self):   # Task 7, problem C
        from test_analyze_song import pickup_into_a_silent_downbeat
        wav, first, down = pickup_into_a_silent_downbeat(self.tmp / "rest.wav")
        full, low, _, _ = A.envelopes(A.decode(wav))
        g = A.beat_grid(full, low)
        beats = g["pos"] / A.FPS_ENV
        d = S.first_downbeat(full, A.FPS_ENV, beats, g["j"], 4)
        self.assertLess(abs(g["times"][d] - down), 0.03, (g["times"][d], down))
        self.assertEqual(S.detect_pickup(full, A.FPS_ENV, beats, g["j"], 4)["beats"], 2)

    def test_a_quiet_but_sounding_downbeat_starts_the_first_bar(self):
        # the first bar's downbeat is quiet (below pickup_onset, above PICKUP_QUIET) and the rest of it is loud: that
        # bar is the first audible bar, not a 3-beat pickup
        beats = np.arange(0.5, 20.0, 0.5)
        env = np.zeros(int(21 * A.FPS_ENV))
        for k, t in enumerate(beats):
            env[int(round(t * A.FPS_ENV))] = 1.0 if k >= 5 else 0.2 if k == 4 else 0.0
        self.assertEqual(S.first_downbeat(env, A.FPS_ENV, beats, 0, 4), 4)
        self.assertIsNone(S.detect_pickup(env, A.FPS_ENV, beats, 0, 4))

    def test_white_noise_gets_no_pickup(self):   # final review: noise from the first sample is not "after silence"
        rng = np.random.default_rng(1)
        wav = _write(self.tmp / "noise.wav", 0.3 * rng.standard_normal(40 * 44100))
        self.assertNotIn("pickup", A.analyze(wav, bars=2)["suggestions"])

    def test_a_pickup_needs_quiet_before_it_when_the_grid_starts_on_it(self):
        # beats 0 and 1 loud, the downbeat 2 loud: a 2-beat pickup only when the level before beat 0 is quiet
        def clicks(first):
            beats = np.arange(first, 20.0, 0.5)
            env = np.zeros(int(21 * A.FPS_ENV))
            env[np.round(beats * A.FPS_ENV).astype(int)] = 1.0
            return beats, env
        beats, env = clicks(0.6)
        loud = env.copy()
        loud[:int(0.3 * A.FPS_ENV)] = 1.0   # sound from the file start (a beat the envelope cannot see)
        self.assertEqual(S.detect_pickup(env, A.FPS_ENV, beats, 2, 4, level_env=env)["beats"], 2)
        self.assertIsNone(S.detect_pickup(env, A.FPS_ENV, beats, 2, 4, level_env=loud))
        # too little audio before the first beat to know (under a quarter beat): no pickup either
        beats, env = clicks(0.1)
        self.assertIsNone(S.detect_pickup(env, A.FPS_ENV, beats, 2, 4, level_env=env))

    def test_no_pickup_when_song_starts_on_the_downbeat(self):
        full, low, beats, song = self.track(bpm=100, offset=0.5)
        self.assertIsNone(S.detect_pickup(full, A.FPS_ENV, beats, self.downbeat(song), 4))


class TempoMap(unittest.TestCase):
    """Task 3: local tempo, the DP beat tracker and segmentation. Envelope time is frame index / FPS_ENV; song time
    adds A.ENV_TIME_OFFSET (what click_track's beat times and the page's clicks use)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def envs(self, seconds=60.0, bpm=120, **kw):
        path = self.tmp / "t.wav"
        click_track(path, bpm, seconds=seconds, **kw)
        full, low, _, _ = A.envelopes(A.decode(path))
        return full, low

    def detect(self, full, global_bpm, bpb=4):
        return S.detect_tempo_map(full, A.FPS_ENV, global_bpm, bpb, A.tempo_candidates,
                                  time_offset=A.ENV_TIME_OFFSET)

    def test_step_90_to_120(self):
        full, low = self.envs(tempo_map=[(0, 90, False), (20, 120, False)])
        r = self.detect(full, A.beat_grid(full, low)["bpm"])
        self.assertIsNotNone(r)
        segs = r["segments"]
        self.assertEqual(len(segs), 2, segs)
        self.assertEqual(segs[0]["t"], 0.0)
        self.assertLessEqual(abs(segs[0]["bpm"] / 90 - 1), 0.02, segs)
        self.assertLessEqual(abs(segs[1]["bpm"] / 120 - 1), 0.02, segs)
        self.assertLessEqual(abs(segs[1]["t"] - 20.0), 4 * 60 / 90, segs)   # within 1 bar
        self.assertFalse(segs[1]["ramp"])
        self.assertTrue(0 <= r["confidence"] <= 1)
        self.assertIsInstance(r["reason"], str)
        # beats are song seconds (3 decimals) on the clicks
        want = beat_times(90, 60.0, tempo_map=[(0, 90, False), (20, 120, False)])
        got = np.array(r["beats"])
        self.assertTrue(all(round(b, 3) == b for b in r["beats"]))
        err = np.array([got[np.argmin(np.abs(got - w))] - w for w in want[1:-1]])
        self.assertLess(abs(np.median(err)), 0.02)                  # the analyser's ~13 ms calibration bias
        self.assertLess(np.max(np.abs(err - np.median(err))), 0.015)

    def test_ramp_100_to_120(self):
        full, low = self.envs(tempo_map=[(0, 100, False), (20, 100, False), (30, 120, True)])
        r = self.detect(full, A.beat_grid(full, low)["bpm"])
        self.assertIsNotNone(r)
        segs = r["segments"]
        ramps = [s for s in segs if s["ramp"]]
        self.assertEqual(len(ramps), 1, segs)
        end = segs.index(ramps[0])
        start = segs[end - 1]
        self.assertLessEqual(abs(start["bpm"] / 100 - 1), 0.02, segs)
        self.assertLessEqual(abs(ramps[0]["bpm"] / 120 - 1), 0.02, segs)
        self.assertLessEqual(abs(start["t"] - 20.0), 4 * 60 / 100, segs)
        self.assertLessEqual(abs(ramps[0]["t"] - 30.0), 4 * 60 / 120, segs)

    def test_steady_120_gets_none(self):
        full, low = self.envs(bpm=120)
        self.assertIsNone(self.detect(full, A.beat_grid(full, low)["bpm"]))

    def test_steady_70_read_as_140_gets_none(self):   # Review Focus 2
        full, low = self.envs(bpm=70)
        self.assertIsNone(self.detect(full, 140.0))
        self.assertTrue(all(abs(b / 140 - 1) <= 0.03 for _, b in S.local_tempo(full, A.FPS_ENV, 140.0,
                                                                                     A.tempo_candidates)))

    def test_short_song_gets_none(self):   # Review Focus 5
        full, low = self.envs(seconds=20.0, bpm=120)
        self.assertIsNone(self.detect(full, 120.0))
        full, low = self.envs(seconds=6.0, bpm=120)
        self.assertIsNone(self.detect(full, 120.0))

    def bias(self, full, low, want):
        """The analyser's own grid sits ~13 ms after the clicks (env_time's calibration, 'within one video frame');
        song_suggest's beats use the same time base, so they are compared to the clicks net of that shared bias."""
        t = A.beat_grid(full, low)["times"]
        return float(np.median([t[np.argmin(np.abs(t - w))] - w for w in want]))

    def test_track_beats_on_a_steady_click(self):
        full, low = self.envs(bpm=120)
        got = S.track_beats(full, A.FPS_ENV, [(0.0, 120.0)]) + A.ENV_TIME_OFFSET
        want = beat_times(120, 60.0)
        err = np.array([got[np.argmin(np.abs(got - w))] - w for w in want])
        bias = self.bias(full, low, want)
        self.assertLess(abs(np.median(err) - bias), 0.002)          # same time base as the analyser's grid
        self.assertLess(np.max(np.abs(err - bias)), 0.015)          # every click found within 15 ms
        gaps = np.diff(got)
        self.assertLess(np.max(np.abs(gaps - 0.5)), 0.03)

    def test_step_80_to_120(self):   # a change bigger than x sqrt(2) is not folded away
        full, low = self.envs(tempo_map=[(0, 80, False), (20, 120, False)])
        r = self.detect(full, A.beat_grid(full, low)["bpm"])
        self.assertIsNotNone(r)
        segs = r["segments"]
        self.assertEqual(len(segs), 2, segs)
        self.assertLessEqual(abs(segs[0]["bpm"] / 80 - 1), 0.02, segs)
        self.assertLessEqual(abs(segs[1]["bpm"] / 120 - 1), 0.02, segs)
        self.assertLessEqual(abs(segs[1]["t"] - 20.0), 4 * 60 / 80, segs)
        self.assertLessEqual(abs(segs[1]["t"] - 20.0), 60 / 80, segs)      # in fact within a beat
        # no beat invented across the change: every tracked beat sits on a click
        want = np.array(beat_times(80, 60.0, tempo_map=[(0, 80, False), (20, 120, False)]))
        got = np.array(r["beats"])
        off = np.array([np.min(np.abs(want - g)) for g in got if want[0] < g < want[-1]])
        self.assertLess(off.max(), 0.03, off.max())

    def test_one_octave_window_in_a_steady_song_gets_none(self):
        full, low = self.envs(bpm=120)
        calls = []

        def flaky(env):   # the 6th window's strongest candidate is the octave above
            cands = A.tempo_candidates(env)
            calls.append(1)
            if len(calls) == 6:
                c = cands[0]
                cands = [(2 * c[0], c[1] * 1.1, c[2] * 1.1)] + cands
            return cands
        curve = S.local_tempo(full, A.FPS_ENV, 120.0, flaky)
        self.assertTrue(all(abs(b / 120 - 1) <= 0.03 for _, b in curve), curve)
        calls.clear()
        self.assertIsNone(S.detect_tempo_map(full, A.FPS_ENV, 120.0, 4, flaky, time_offset=A.ENV_TIME_OFFSET))

    def test_confidence_is_high_on_a_clean_step(self):
        full, low = self.envs(tempo_map=[(0, 90, False), (20, 120, False)])
        r = self.detect(full, A.beat_grid(full, low)["bpm"])
        self.assertGreaterEqual(r["confidence"], 0.8, r["confidence"])

    def test_confidence_is_low_on_a_noisy_step(self):
        full, low = self.envs(tempo_map=[(0, 90, False), (20, 120, False)])
        clean = self.detect(full, A.beat_grid(full, low)["bpm"])["confidence"]
        rng = np.random.default_rng(3)
        noisy = full + rng.exponential(12 * full.mean(), len(full))   # dense random onsets bury the clicks
        r = self.detect(noisy, A.beat_grid(full, low)["bpm"])
        self.assertTrue(r is None or r["confidence"] <= 0.5 * clean, (clean, r and r["confidence"]))
        noise = rng.exponential(30.0, len(full))   # no beat at all: whatever the tracker finds is not believed
        r = S.detect_tempo_map(noise, A.FPS_ENV, 120.0, 4, A.tempo_candidates, time_offset=A.ENV_TIME_OFFSET)
        self.assertTrue(r is None or r["confidence"] <= 0.2, r and r["confidence"])

    def steady_with_a_4_3_section(self):
        """A steady 90 BPM click with a louder 120 BPM click mixed in from 20 to 40 s (four against three): the
        windows there read 120, 4:3 of the song's tempo, while the 90 clicks carry on underneath (Tease Me's misread)."""
        a = click_track(self.tmp / "a.wav", 90, seconds=60.0)
        b = click_track(self.tmp / "b.wav", 120, seconds=60.0, hat=0.45, seed=5)
        params, x = _read(a)
        _, y = _read(b)
        gate = np.zeros_like(y)
        gate[20 * params.framerate:40 * params.framerate] = 1
        path = self.tmp / "m.wav"
        with wave.open(str(path), "wb") as w:
            w.setparams(params)
            w.writeframes(np.clip(x + y * gate, -32768, 32767).astype("<i2").tobytes())
        full, low, _, _ = A.envelopes(A.decode(path))
        return full, low

    def test_a_4_3_misread_section_is_folded_and_gets_no_map(self):   # Task 7, problem A
        full, low = self.steady_with_a_4_3_section()
        bpm = A.beat_grid(full, low)["bpm"]
        curve = S.local_tempo(full, A.FPS_ENV, bpm, A.tempo_candidates)
        self.assertTrue(all(abs(b / 90 - 1) <= 0.03 for _, b in curve), curve)
        self.assertIsNone(self.detect(full, bpm))

    def test_a_false_map_scores_below_the_floor(self):   # Task 7: confidence alone also rejects the misread
        full, low = self.steady_with_a_4_3_section()
        bpm = A.beat_grid(full, low)["bpm"]
        saved = S.THRESHOLDS["alias_present"]
        try:
            S.THRESHOLDS["alias_present"] = 2.0   # no window folded: the 4:3 section is segmented as a change
            self.assertIsNone(self.detect(full, bpm))
        finally:
            S.THRESHOLDS["alias_present"] = saved

    def test_step_96_to_120_is_kept(self):   # a real change at a non-metrical ratio (1.25)
        full, low = self.envs(tempo_map=[(0, 96, False), (20, 120, False)])
        r = self.detect(full, A.beat_grid(full, low)["bpm"])
        self.assertIsNotNone(r)
        self.assertEqual([round(s["bpm"]) for s in r["segments"]], [96, 120], r["segments"])
        self.assertGreaterEqual(r["confidence"], 0.8, r["confidence"])

    def test_three_percent_wobble_gets_none(self):
        full, low = self.envs(tempo_map=[(0, 120, False), (15, 116.4, False), (30, 120, False), (45, 123.6, False)])
        self.assertIsNone(self.detect(full, A.beat_grid(full, low)["bpm"]))

    def test_one_odd_first_bar_is_not_a_segment(self):
        beats = beat_times(100, 60.0, offset=0.0, tempo_map=[(0, 100, False), (2.4, 120, False)])
        self.assertEqual(len(S.segment_tempo(beats, 4)), 1, S.segment_tempo(beats, 4))

    def test_segment_tempo_on_exact_beats(self):
        steady = S.segment_tempo(beat_times(120, 60.0), 4)
        self.assertEqual(len(steady), 1)
        self.assertEqual(steady[0]["t"], 0.0)
        step = S.segment_tempo(beat_times(90, 60.0, tempo_map=[(0, 90, False), (20, 120, False)]), 4)
        self.assertEqual([round(s["bpm"]) for s in step], [90, 120])
        self.assertEqual([s["ramp"] for s in step], [False, False])


class At(unittest.TestCase):
    def test_linear_interpolation_and_zero_outside(self):
        env = np.array([0.0, 2.0, 4.0])
        self.assertAlmostEqual(S.at(env, 10.0, 0.05), 1.0)
        self.assertAlmostEqual(S.at(env, 10.0, 0.2), 4.0)
        self.assertEqual(S.at(env, 10.0, -0.01), 0.0)
        self.assertEqual(S.at(env, 10.0, 0.3), 0.0)

    def test_thresholds_are_the_planned_starting_values(self):
        self.assertEqual(set(S.THRESHOLDS), {"swing_min", "swing_share", "triplet_tol", "meter_margin",
                                             "pickup_onset", "tempo_change", "tempo_bars", "ramp_bars",
                                             "triplet_fit", "alias_present", "tempo_map_min", "swing_cluster"})


if __name__ == "__main__":
    unittest.main()
