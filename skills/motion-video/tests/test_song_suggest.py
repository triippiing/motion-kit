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
from click_track import click_track  # noqa: E402


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

    def test_triplet_tempo_correction(self):
        # a 96 BPM shuffle whose tempo was read as 128 (4/3): the suggestion carries bpm ~96. The click track analyses
        # at 96 (a forced 128 grid puts every other grid beat in silence, so no swing can be read on it); the swing is
        # read on the 96 grid and the mis-read tempo is passed in, which is all the 4/3 correction looks at.
        full, low, beats, song = self.track(bpm=96, swing=0.667)
        r = S.detect_swing(full, A.FPS_ENV, beats, 128.0, song["alternatives"] + [96.0])
        self.assertLessEqual(abs(r["bpm"] - 96.0), 2.0)
        self.assertIn("96", r["reason"])

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


class At(unittest.TestCase):
    def test_linear_interpolation_and_zero_outside(self):
        env = np.array([0.0, 2.0, 4.0])
        self.assertAlmostEqual(S.at(env, 10.0, 0.05), 1.0)
        self.assertAlmostEqual(S.at(env, 10.0, 0.2), 4.0)
        self.assertEqual(S.at(env, 10.0, -0.01), 0.0)
        self.assertEqual(S.at(env, 10.0, 0.3), 0.0)

    def test_thresholds_are_the_planned_starting_values(self):
        self.assertEqual(set(S.THRESHOLDS), {"swing_min", "swing_share", "triplet_tol", "meter_margin",
                                             "pickup_onset", "tempo_change", "tempo_bars", "ramp_bars"})


if __name__ == "__main__":
    unittest.main()
