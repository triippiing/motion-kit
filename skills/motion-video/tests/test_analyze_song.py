import contextlib
import io
import json
import shutil
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

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

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
        # Only the file name is recorded: no local path (or user name) ends up in a published song.json.
        self.assertEqual(song["source"], "Tints (feat. Test) copy.wav")
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

    def test_cli_bad_numbers_and_unwritable_out_are_clean_errors(self):
        song = str(click_track(self.tmp / "e.wav", 120))
        for flag in ("--bars", "--fps"):
            for bad in ("0", "-2", "x"):
                r = self._cli(song, flag, bad)
                self.assertEqual(r.returncode, 2, (flag, bad, r.stderr))
                self.assertIn("error:", r.stderr)
                self.assertNotIn("Traceback", r.stderr)
        blocker = self.tmp / "afile"
        blocker.write_text("x")
        r = self._cli(song, "--out", str(blocker / "sub"), "--bars", "2")
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn("error:", r.stderr)
        self.assertNotIn("Traceback", r.stderr)


class SyncTests(unittest.TestCase):
    """The user's sync section in song.json: kept across re-runs and applied to the grid."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.wav = str(click_track(cls.tmp / "c120.wav", 120, seconds=30))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        self.d = Path(tempfile.mkdtemp(dir=self.tmp))

    def run_main(self, *args, sync=None):
        if sync is not None:
            (self.d / "song.json").write_text(json.dumps({"sync": sync}))
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            try:
                code = A.main([self.wav, "--out", str(self.d), *args])
            except SystemExit as e:
                code = e.code
        return code, err.getvalue()

    def song(self):
        return json.loads((self.d / "song.json").read_text())

    def test_sync_is_preserved_and_markers_derived(self):
        code, err = self.run_main("--bars", "2", "--start-bar", "1")
        self.assertEqual(code, 0, err)
        start = self.song()["loop"]["start_sec"]
        drop_t = round(start + 1.234, 3)
        sync = {"nudge_ms": 0, "swing": 0.6, "markers": [{"name": "drop", "t": drop_t}]}
        code, err = self.run_main("--bars", "2", "--start-bar", "1", sync=sync)
        self.assertEqual(code, 0, err)
        song = self.song()
        self.assertEqual(song["sync"], sync)
        self.assertEqual(song["loop"]["start_sec"], start)
        self.assertEqual(song["markers"], [{"name": "drop", "song_t": drop_t,
                                            "t": round(drop_t - start, 6), "in_loop": True}])
        # a third run reads the sync written by the second
        code, err = self.run_main("--bars", "2", "--start-bar", "1")
        self.assertEqual(code, 0, err)
        self.assertEqual(self.song()["sync"], sync)

    def test_marker_outside_the_loop(self):
        sync = {"markers": [{"name": "intro", "t": 0.5}, {"name": "outro-2", "t": 25.0}]}
        code, err = self.run_main("--bars", "2", "--start-bar", "2", sync=sync)
        self.assertEqual(code, 0, err)
        song = self.song()
        start = song["loop"]["start_sec"]
        by = {m["name"]: m for m in song["markers"]}
        self.assertFalse(by["intro"]["in_loop"])
        self.assertAlmostEqual(by["intro"]["t"], 0.5 - start, places=6)
        self.assertFalse(by["outro-2"]["in_loop"])
        self.assertAlmostEqual(by["outro-2"]["t"], 25.0 - start, places=6)

    def test_nudge_moves_the_grid_and_skips_snapping(self):
        code, err = self.run_main("--bars", "2", "--start-bar", "2")
        self.assertEqual(code, 0, err)
        plain = self.song()
        code, err = self.run_main("--bars", "2", "--start-bar", "2", sync={"nudge_ms": -20})
        self.assertEqual(code, 0, err)
        nudged = self.song()
        self.assertAlmostEqual(nudged["loop"]["start_sec"], plain["loop"]["start_sec"] - 0.020, delta=1e-3)
        self.assertEqual(nudged["loop"]["duration_sec"], plain["loop"]["duration_sec"])
        self.assertEqual(nudged["bpm"], plain["bpm"])
        for b in nudged["beats"]:
            self.assertEqual(b["cue_t"], b["t"])

    def test_bpm_override(self):
        code, err = self.run_main("--bars", "2", sync={"bpm": 100})
        self.assertEqual(code, 0, err)
        song = self.song()
        self.assertEqual(song["bpm"], 100.0)
        self.assertAlmostEqual(song["beat_sec"], 0.6, places=9)
        self.assertAlmostEqual(song["loop"]["duration_sec"], 2 * 4 * 0.6, places=9)
        for b in song["beats"]:
            self.assertEqual(b["cue_t"], b["t"])

    def test_meter(self):
        for meter, bpb in (("3/4", 3), ("6/8", 2), ("4/4", 4)):
            with self.subTest(meter=meter):
                code, err = self.run_main("--bars", "3", sync={"meter": meter})
                self.assertEqual(code, 0, err)
                song = self.song()
                self.assertEqual(song["beats_per_bar"], bpb)
                self.assertEqual(len(song["beats"]), 3 * bpb)
                self.assertEqual([b["beat_in_bar"] for b in song["beats"][:bpb]], list(range(bpb)))

    def test_start_near_picks_the_nearest_bar(self):
        code, err = self.run_main("--bars", "2", "--start-bar", "0")
        self.assertEqual(code, 0, err)
        bar0 = self.song()["loop"]["start_sec"]
        bar = self.song()["beats_per_bar"] * self.song()["beat_sec"]
        for want in (3, 5):
            with self.subTest(bar=want):
                code, err = self.run_main("--bars", "2", "--start-near", str(bar0 + want * bar + 0.3 * bar))
                self.assertEqual(code, 0, err)
                self.assertEqual(self.song()["loop"]["start_bar"], want)
        code, err = self.run_main("--bars", "2", "--start-near", "-50")
        self.assertEqual(code, 0, err)
        self.assertEqual(self.song()["loop"]["start_bar"], 0)
        code, err = self.run_main("--bars", "2", "--start-bar", "1", "--start-near", "4")
        self.assertEqual(code, 2)
        self.assertIn("error:", err)

    def test_source_json_records_the_absolute_path(self):
        code, err = self.run_main("--bars", "2")
        self.assertEqual(code, 0, err)
        src = json.loads((self.d / ".source.json").read_text())
        self.assertEqual(src, {"path": str(Path(self.wav).resolve())})
        self.assertEqual(self.song()["source"], "c120.wav")

    def test_bad_sync_values_exit_2(self):
        bad = [
            ({"meter": "5/4"}, "meter"),
            ({"swing": 0.8}, "swing"),
            ({"swing": "x"}, "swing"),
            ({"markers": [{"name": "drop", "t": 1}, {"name": "drop", "t": 2}]}, "drop"),
            ({"markers": [{"name": "4drop", "t": 1}]}, "4drop"),
            ({"markers": [{"name": "Drop", "t": 1}]}, "Drop"),
            ({"markers": [{"name": "drop", "t": "soon"}]}, "drop"),
            ({"markers": [{"name": "drop", "t": True}]}, "drop"),
            ({"markers": "drop"}, "markers"),
            ({"bpm": 500}, "bpm"),
            ({"bpm": 30}, "bpm"),
            ({"bpm": 250}, "bpm"),
            ({"bpm": "fast"}, "bpm"),
            ({"nudge_ms": "x"}, "nudge_ms"),
            ([1, 2], "sync"),
        ]
        for sync, word in bad:
            with self.subTest(sync=sync):
                code, err = self.run_main("--bars", "2", sync=sync)
                self.assertEqual(code, 2, err)
                self.assertTrue(err.startswith("error:"), err)
                self.assertIn(word, err)
                self.assertNotIn("Traceback", err)

    def test_window_off_the_song_leaves_files_untouched(self):
        code, err = self.run_main("--bars", "2", "--start-bar", "0")
        self.assertEqual(code, 0, err)
        before = {n: (self.d / n).read_bytes() for n in ("song.json", "clip.wav")}
        cases = [
            (("--start-bar", "0"), {"nudge_ms": -500}, "before the song"),
            (("--start-near", "1e6"), {"nudge_ms": 3000}, "past the end"),
            (("--start-near", "1e6"), {"bpm": 60}, "past the end"),
        ]
        for args, sync, msg in cases:
            with self.subTest(sync=sync):
                # put the sync in the existing song.json without touching anything else
                old = json.loads(before["song.json"])
                old["sync"] = sync
                (self.d / "song.json").write_text(json.dumps(old, indent=2))
                snap = {n: (self.d / n).read_bytes() for n in ("song.json", "clip.wav")}
                code, err = self.run_main("--bars", "2", *args)
                self.assertEqual(code, 2, err)
                self.assertTrue(err.startswith("error:"), err)
                self.assertIn(msg, err)
                for n, data in snap.items():
                    self.assertEqual((self.d / n).read_bytes(), data, n)
                self.assertEqual(sorted(p.name for p in self.d.iterdir()),
                                 [".source.json", "clip.wav", "song.json"])

    def test_malformed_song_json_warns_and_continues(self):
        (self.d / "song.json").write_text("{not json")
        code, err = self.run_main("--bars", "2")
        self.assertEqual(code, 0, err)
        self.assertIn("warning: could not read the existing song.json; its sync section is not kept", err)
        self.assertNotIn("sync", self.song())

    def test_song_json_that_is_not_an_object_warns_and_continues(self):
        (self.d / "song.json").write_text("[]")
        code, err = self.run_main("--bars", "2")
        self.assertEqual(code, 0, err)
        self.assertIn("warning: could not read the existing song.json; its sync section is not kept", err)
        self.assertNotIn("sync", self.song())

    def test_start_near_must_be_finite(self):
        for bad in ("nan", "inf", "-inf", "soon"):
            with self.subTest(bad=bad):
                code, err = self.run_main("--bars", "2", "--start-near", bad)
                self.assertEqual(code, 2, err)
                self.assertIn("error:", err)
                self.assertNotIn("Traceback", err)

    def test_no_sync_means_no_change(self):
        none = A.analyze(self.wav, bars=2)
        self.assertNotIn("sync", none)
        self.assertNotIn("markers", none)
        defaults = {"nudge_ms": 0, "bpm": None, "meter": "4/4", "swing": 0.5, "markers": []}
        for sync in ({}, defaults):
            with self.subTest(sync=sync):
                song = A.analyze(self.wav, bars=2, sync=sync)
                self.assertEqual(song.pop("sync"), sync)
                self.assertEqual(song.pop("markers"), [])
                self.assertEqual(song, none)
        # onset snapping still runs without a user grid: the 120 BPM click's grid is
        # fitted at 120.001 BPM, so the cues pull back onto the clicks
        self.assertTrue(any(b["cue_t"] != b["t"] for b in none["beats"]))
        beat = none["beat_sec"]
        start = none["loop"]["start_sec"]
        for b in none["beats"]:
            phase = (start + b["cue_t"] - 0.37) % beat
            self.assertLess(min(phase, beat - phase), beat / 8)

    def test_short_song_window_choice_is_unchanged(self):
        # the 16 s songs the Node harness uses: the loudest section start is still preferred without a
        # user grid, and with a nudge the pick skips windows that would run off the song
        short = str(click_track(self.d / "short.wav", 120, seconds=16))
        plain = A.analyze(short, bars=2)
        self.assertTrue(plain["sections"])
        self.assertIn(plain["loop"]["start_bar"], [s["bar"] for s in plain["sections"]])
        self.assertEqual(A.analyze(short, bars=2, sync={"nudge_ms": 0})["loop"], plain["loop"])
        nudged = A.analyze(short, bars=2, sync={"nudge_ms": 10})
        self.assertLessEqual(nudged["loop"]["start_sec"] + nudged["loop"]["duration_sec"], 16.0)

    def test_written_files_have_the_usual_mode(self):
        code, err = self.run_main("--bars", "2")
        self.assertEqual(code, 0, err)
        for name in ("song.json", "clip.wav", ".source.json"):
            self.assertEqual((self.d / name).stat().st_mode & 0o777, 0o666 & ~A.UMASK, name)

    def test_no_sync_writes_no_sync_or_markers_key(self):
        code, err = self.run_main("--bars", "2")
        self.assertEqual(code, 0, err)
        song = self.song()
        self.assertNotIn("sync", song)
        self.assertNotIn("markers", song)


if __name__ == "__main__":
    unittest.main()
