import json
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
import analyze_song as A  # noqa: E402

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


class AnalyzeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_tempo_within_half_bpm(self):
        for bpm in (90, 109, 120, 128):
            with self.subTest(bpm=bpm):
                song = A.analyze(click_track(self.tmp / f"c{bpm}.wav", bpm), bars=4)
                self.assertLessEqual(abs(song["bpm"] - bpm), 0.5, song["bpm"])

    def test_downbeat_lands_on_the_kick_within_one_frame(self):
        offset, bpm = 0.37, 120
        song = A.analyze(click_track(self.tmp / "c.wav", bpm, offset=offset), bars=4)
        bar = 4 * 60.0 / bpm
        for t in (song["downbeat_sec"], song["loop"]["start_sec"]):
            phase = (t - offset) % bar
            self.assertLess(min(phase, bar - phase), 1 / 60, t)

    def test_noisy_track_with_quiet_beat_still_analyses(self):
        path = click_track(self.tmp / "noisy.wav", 100, noise=0.05, hat=0.08, seed=3)
        song = A.analyze(path, bars=4)
        self.assertLessEqual(abs(song["bpm"] - 100), 1.0, song["bpm"])

    def test_loop_arithmetic_closes_exactly(self):
        song = A.analyze(click_track(self.tmp / "c.wav", 109), bars=7)
        loop = song["loop"]
        self.assertAlmostEqual(loop["duration_sec"], 7 * 4 * 60 / song["bpm"], places=6)
        self.assertAlmostEqual(loop["frame_dt"] * loop["frames"], loop["duration_sec"], places=9)
        self.assertEqual(len(song["beats"]), 28)
        self.assertEqual(song["beats"][0]["t"], 0.0)
        frames = [b["frame"] for b in song["beats"]]
        self.assertEqual(frames, sorted(frames))
        for b in song["beats"]:
            self.assertLessEqual(abs(b["cue_t"] - b["t"]), song["beat_sec"] / 8 + 1e-9)

    def test_rules(self):
        s120 = A.analyze(click_track(self.tmp / "a.wav", 120), bars=7, states=12)
        self.assertEqual(s120["rules"]["warnings"], [])
        self.assertEqual(s120["rules"]["min_hold_beats"], 2)
        self.assertEqual(s120["rules"]["max_states"], 14)
        self.assertAlmostEqual(s120["rules"]["spring"]["settle_sec"], 0.3, places=3)
        s90 = A.analyze(click_track(self.tmp / "b.wav", 90), bars=4)
        self.assertTrue(any("100–130" in w for w in s90["rules"]["warnings"]))
        too_many = A.analyze(click_track(self.tmp / "c.wav", 120), bars=2, states=12)
        self.assertTrue(any("states" in w for w in too_many["rules"]["warnings"]))

    def test_start_bar_override(self):
        song = A.analyze(click_track(self.tmp / "c.wav", 120, offset=0.37), bars=4, start_bar=3)
        self.assertAlmostEqual(song["loop"]["start_sec"], song["downbeat_sec"] + 3 * 2.0, delta=1 / 60)

    def _cli(self, *args):
        return subprocess.run([sys.executable, str(SCRIPTS / "analyze_song.py"), *args],
                              capture_output=True, text=True)

    def test_cli_writes_song_json_and_exact_length_clip(self):
        song_path = click_track(self.tmp / "Tints (feat. Test) copy.wav", 120)
        out = self.tmp / "proj dir"
        r = self._cli(str(song_path), "--out", str(out), "--bars", "4")
        self.assertEqual(r.returncode, 0, r.stderr)
        song = json.loads((out / "song.json").read_text())
        with wave.open(str(out / "clip.wav")) as w:
            dur = w.getnframes() / w.getframerate()
        self.assertAlmostEqual(dur, song["loop"]["duration_sec"], delta=0.005)

    def test_cli_errors_are_clear(self):
        r = self._cli(str(self.tmp / "nope.flac"))
        self.assertEqual(r.returncode, 2)
        self.assertIn("no such file", r.stderr)
        silent = self.tmp / "silent.wav"
        with wave.open(str(silent), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes(np.zeros(SR * 5, "<i2").tobytes())
        r = self._cli(str(silent))
        self.assertEqual(r.returncode, 2)
        self.assertIn("silent", r.stderr)
        r = self._cli(str(click_track(self.tmp / "short.wav", 120, seconds=10)), "--bars", "20")
        self.assertEqual(r.returncode, 2)
        self.assertIn("shorter than", r.stderr)


if __name__ == "__main__":
    unittest.main()
