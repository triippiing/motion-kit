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
        full, low, _ = A.envelopes(A.decode(path))
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
        full, low, _ = A.envelopes(A.decode(path))
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
                                             "triplet_fit"})


if __name__ == "__main__":
    unittest.main()
