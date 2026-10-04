import contextlib
import hashlib
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
import song_suggest as S  # noqa: E402
from click_track import SR, beat_times, click_track  # noqa: E402,F401  (also imported from here by older commands)

# sha256 of click_track(path, 120, seconds=10) from click_track.py on main before C2b (defaults must stay byte-identical)
# main before C2b: the last commit before this sub-project first changed analyze_song.py (the parity reference)
PRE_C2B = "f762389d5eb156aacafa2c02b5724d3ae9bbb5ae"
KNOWN_120_10S = "9d2ba13dd3a29f5309b955ac6acb6b23bafbf845ccbd293857d04fc13ef7bc70"


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

    def overrun_track(self):
        """120 BPM (a bar is 2 s): ten bars from the first click, then 1.6 s of an eleventh, so the grid's last bar
        ends about 0.4 s past the audio. The last 3.6 s are louder, so a free pick favours the final window."""
        p = click_track(self.tmp / "over.wav", 120, seconds=0.37 + 20 + 1.6)
        with wave.open(str(p)) as w:
            x = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(float)
        x[-int(3.6 * SR):] *= 3
        with wave.open(str(p), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(np.clip(x, -32768, 32767).astype("<i2").tobytes())
        return p, len(x) / SR

    def test_free_pick_skips_windows_past_the_end(self):
        p, song_sec = self.overrun_track()
        loop = A.analyze(p, bars=2)["loop"]
        self.assertLessEqual(loop["start_sec"] + loop["duration_sec"], song_sec)

    def test_forced_overrun_pads_the_clip_and_warns(self):
        p, song_sec = self.overrun_track()
        out = self.tmp / "o"
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(A.main([str(p), "--out", str(out), "--bars", "2", "--start-near", "1e6"]), 0)
        song = json.loads((out / "song.json").read_text())
        loop = song["loop"]
        self.assertGreater(loop["start_sec"] + loop["duration_sec"], song_sec)  # the case under test
        self.assertTrue(any("past the end of the song" in w for w in song["rules"]["warnings"]), song["rules"]["warnings"])
        with wave.open(str(out / "clip.wav")) as w:
            self.assertLessEqual(abs(w.getnframes() - round(loop["duration_sec"] * 48000)), 1)

    def test_no_padding_warning_when_the_loop_fits(self):
        song = A.analyze(click_track(self.tmp / "c.wav", 120, seconds=30), bars=2)
        self.assertFalse(any("past the end" in w for w in song["rules"]["warnings"]))


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

    def test_marker_note_round_trips(self):
        note = "the roll into the chorus, Bar 3!"
        sync = {"markers": [{"name": "snare", "t": 1.0, "note": note}, {"name": "drop", "t": 2.0}]}
        for _ in range(2):  # the second run reads the sync the first wrote
            code, err = self.run_main("--bars", "2", "--start-bar", "1", **({"sync": sync} if _ == 0 else {}))
            self.assertEqual(code, 0, err)
            song = self.song()
            self.assertEqual(song["sync"], sync)
            by = {m["name"]: m for m in song["markers"]}
            self.assertEqual(by["snare"]["note"], note)
            self.assertNotIn("note", by["drop"])
        code, err = self.run_main("--bars", "2", "--start-bar", "1",
                                  sync={"markers": [{"name": "snare", "t": 1.0, "note": "x" * 200}]})
        self.assertEqual(code, 0, err)

    def test_checked_by_ear_date_is_kept(self):
        sync = {"checked_by_ear": "2026-10-01"}
        code, err = self.run_main("--bars", "2", sync=sync)
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
            ({"markers": [{"name": "drop", "t": 1, "note": 7}]}, "note"),
            ({"markers": [{"name": "drop", "t": 1, "note": None}]}, "note"),
            ({"markers": [{"name": "drop", "t": 1, "note": "x" * 201}]}, "201 characters"),
            ([1, 2], "sync"),
            ({"checked_by_ear": "yesterday"}, "checked_by_ear"),
            ({"checked_by_ear": '<img src=x onerror="window.__xss=1">'}, "checked_by_ear"),
            ({"checked_by_ear": "2026-10-01<b>"}, "checked_by_ear"),
            ({"checked_by_ear": 20261001}, "checked_by_ear"),
            ({"checked_by_ear": True}, "checked_by_ear"),
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

    def test_short_song_window_prefers_sections_that_fit(self):
        # a section start is still preferred without a user grid when its window fits (20 s: bar 6);
        # in the 16 s songs the Node harness uses, the only section's window runs off the song, so the
        # pick stays inside, and with a nudge too
        longer = A.analyze(str(click_track(self.d / "longer.wav", 120, seconds=20)), bars=2)
        self.assertTrue(longer["sections"])
        self.assertIn(longer["loop"]["start_bar"], [s["bar"] for s in longer["sections"]])
        short = str(click_track(self.d / "short.wav", 120, seconds=16))
        plain = A.analyze(short, bars=2)
        self.assertLessEqual(plain["loop"]["start_sec"] + plain["loop"]["duration_sec"], 16.0)
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


class SuggestionTests(unittest.TestCase):
    """C2b Task 4: the analyser writes `suggestions` (never applied by itself) and applies the new sync fields."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        t = cls.tmp
        cls.straight = str(click_track(t / "straight.wav", 120, seconds=30))
        cls.swing = str(click_track(t / "swing.wav", 110, seconds=30, swing=0.62))
        cls.three = str(click_track(t / "three.wav", 150, seconds=30, meter="3/4"))
        cls.pickup = str(click_track(t / "pickup.wav", 100, seconds=30, offset=0.5, pickup=2))
        cls.step_map = [(0, 90, False), (20, 120, False)]
        cls.step = str(click_track(t / "step.wav", 90, seconds=60, tempo_map=cls.step_map))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        self.d = Path(tempfile.mkdtemp(dir=self.tmp))

    def run_main(self, wav, *args, sync=None):
        if sync is not None:
            (self.d / "song.json").write_text(json.dumps({"sync": sync}))
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            try:
                code = A.main([wav, "--out", str(self.d), *args])
            except SystemExit as e:
                code = e.code
        return code, err.getvalue()

    def song(self):
        return json.loads((self.d / "song.json").read_text())

    def test_straight_track_gets_no_suggestions(self):
        self.assertEqual(A.analyze(self.straight, bars=2)["suggestions"], {})

    def test_each_case_is_suggested_and_written(self):
        cases = [(self.swing, "swing", lambda s: abs(s["value"] - 0.62) <= 0.03),
                 (self.three, "meter", lambda s: s["value"] == "3/4"),
                 (self.pickup, "pickup", lambda s: s["beats"] == 2),
                 (self.step, "tempo_map", lambda s: len(s["segments"]) == 2 and isinstance(s["beats"], list))]
        for wav, key, ok in cases:
            with self.subTest(key=key):
                # through main(), so the suggestions are written as JSON (no numpy scalars)
                code, err = self.run_main(wav, "--bars", "2")
                self.assertEqual(code, 0, err)
                sug = self.song()["suggestions"]
                self.assertIn(key, sug)
                self.assertTrue(ok(sug[key]), sug[key])
                self.assertTrue(0 <= sug[key]["confidence"] <= 1)
                self.assertIsInstance(sug[key]["reason"], str)
                self.assertNotIn("sync", self.song())   # suggestions only: nothing is applied

    def test_dismissed_hides_the_same_value_and_shows_a_changed_one(self):
        v = A.analyze(self.swing, bars=2)["suggestions"]["swing"]["value"]
        same = A.analyze(self.swing, bars=2, sync={"dismissed": [{"key": "swing", "value": v}]})
        self.assertNotIn("swing", same["suggestions"])
        other = A.analyze(self.swing, bars=2, sync={"dismissed": [{"key": "swing", "value": round(v + 0.05, 2)}]})
        self.assertIn("swing", other["suggestions"])
        m = A.analyze(self.three, bars=2)["suggestions"]["meter"]["value"]
        self.assertNotIn("meter", A.analyze(self.three, bars=2,
                                            sync={"dismissed": [{"key": "meter", "value": m}]})["suggestions"])

    def test_a_kept_suggestion_is_not_suggested_again(self):
        v = A.analyze(self.swing, bars=2)["suggestions"]["swing"]["value"]
        self.assertNotIn("swing", A.analyze(self.swing, bars=2, sync={"swing": v})["suggestions"])
        self.assertNotIn("swing", A.analyze(self.swing, bars=2, sync={"swing": v + 0.02})["suggestions"])
        self.assertIn("swing", A.analyze(self.swing, bars=2, sync={"swing": 0.7})["suggestions"])
        self.assertNotIn("meter", A.analyze(self.three, bars=2, sync={"meter": "3/4"})["suggestions"])
        self.assertNotIn("pickup", A.analyze(self.pickup, bars=2, sync={"pickup_beats": 2})["suggestions"])
        segs = A.analyze(self.step, bars=2)["suggestions"]["tempo_map"]["segments"]
        self.assertNotIn("tempo_map", A.analyze(self.step, bars=2, sync={"tempo_map": segs})["suggestions"])

    def test_a_tempo_map_suggestion_holds_back_the_grid_detectors(self):
        # meter, swing and pickup measured on a single grid the tempo map says is wrong are not offered
        sug = A.analyze(self.step, bars=2)["suggestions"]
        self.assertEqual(set(sug), {"tempo_map"}, sug)
        tm = sug["tempo_map"]
        calls = []
        real = S.detect_pickup
        try:
            S.detect_pickup = lambda *a, **k: calls.append(1) or real(*a, **k)
            dismissed = A.analyze(self.step, bars=2,
                                  sync={"dismissed": [{"key": "tempo_map", "value": tm["segments"]}]})["suggestions"]
        finally:
            S.detect_pickup = real
        self.assertNotIn("tempo_map", dismissed)
        self.assertTrue(calls, "dismissing the map runs the other detectors again")
        kept = A.analyze(self.step, bars=2, sync={"tempo_map": tm["segments"]})["suggestions"]
        self.assertNotIn("tempo_map", kept)
        self.assertNotIn("pickup", kept)   # measured on the map grid: no false pickup

    def test_bad_new_sync_values_exit_2(self):
        ok = [{"t": 0, "bpm": 90, "ramp": False}, {"t": 20, "bpm": 120, "ramp": False}]
        bad = [
            ({"tempo_map": "fast"}, "tempo_map"),
            ({"tempo_map": []}, "tempo_map"),
            ({"tempo_map": [{"t": 1, "bpm": 90}]}, "tempo_map"),
            ({"tempo_map": [ok[0], {"t": 20, "bpm": 300, "ramp": False}]}, "tempo_map"),
            ({"tempo_map": [ok[0], {"t": 20, "bpm": 30}]}, "tempo_map"),
            ({"tempo_map": [ok[1] | {"t": 0}, ok[0] | {"t": 0}]}, "tempo_map"),
            ({"tempo_map": [ok[0], {"t": 20, "bpm": 120}, {"t": 10, "bpm": 100}]}, "tempo_map"),
            ({"tempo_map": [ok[0], {"t": 20, "bpm": 120, "ramp": "yes"}]}, "tempo_map"),
            ({"tempo_map": [ok[0], {"t": "x", "bpm": 120}]}, "tempo_map"),
            ({"tempo_map": [ok[0], 7]}, "tempo_map"),
            ({"pickup_beats": 4}, "pickup_beats"),
            ({"pickup_beats": 3, "meter": "3/4"}, "pickup_beats"),
            ({"pickup_beats": -1}, "pickup_beats"),
            ({"pickup_beats": 1.5}, "pickup_beats"),
            ({"pickup_beats": True}, "pickup_beats"),
            ({"dismissed": "swing"}, "dismissed"),
            ({"dismissed": ["swing"]}, "dismissed"),
            ({"dismissed": [{"key": "tempo", "value": 1}]}, "dismissed"),
            ({"dismissed": [{"key": "swing"}]}, "dismissed"),
        ]
        for sync, word in bad:
            with self.subTest(sync=sync):
                code, err = self.run_main(self.straight, "--bars", "2", sync=sync)
                self.assertEqual(code, 2, err)
                self.assertTrue(err.startswith("error:"), err)
                self.assertIn(word, err)
                self.assertNotIn("Traceback", err)

    def test_tempo_map_grid_follows_the_map_and_keeps_markers(self):
        segs = A.analyze(self.step, bars=2)["suggestions"]["tempo_map"]["segments"]
        markers = [{"name": "change", "t": 20.0}, {"name": "early", "t": 3.21}]
        code, err = self.run_main(self.step, "--bars", "4", "--start-near", "17",
                                  sync={"tempo_map": segs, "markers": markers})
        self.assertEqual(code, 0, err)
        song = self.song()
        self.assertEqual(song["bpm"], segs[0]["bpm"])
        beats = song["beats"]
        start = song["loop"]["start_sec"]
        self.assertLess(start, 20.0)
        self.assertGreater(start + beats[-1]["t"], 20.0)   # the loop crosses the step
        clicks = np.array(beat_times(90, 60.0, tempo_map=self.step_map))
        near = [int(np.argmin(np.abs(clicks - (start + b["t"])))) for b in beats]
        self.assertEqual(near, list(range(near[0], near[0] + len(beats))), "one grid beat per click")
        for a, b, k in zip(beats, beats[1:], near):
            want = clicks[k + 1] - clicks[k]
            self.assertLessEqual(abs((b["t"] - a["t"]) / want - 1), 0.02, (a, b, want))
        for b in beats:
            self.assertEqual(b["cue_t"], b["t"])   # an ear-set grid
        last = beats[-1]["t"] + (beats[-1]["t"] - beats[-2]["t"])
        self.assertAlmostEqual(song["loop"]["duration_sec"], last, delta=1e-3)
        self.assertAlmostEqual(song["loop"]["frame_dt"] * song["loop"]["frames"], song["loop"]["duration_sec"],
                               places=9)
        # markers stay in song time (Review Focus 3); their loop time follows the new loop start
        by = {m["name"]: m for m in song["markers"]}
        for m in markers:
            self.assertEqual(by[m["name"]]["song_t"], m["t"])
            self.assertAlmostEqual(by[m["name"]]["t"], m["t"] - start, places=6)
        self.assertTrue(by["change"]["in_loop"])
        self.assertFalse(by["early"]["in_loop"])
        self.assertEqual(song["sync"]["tempo_map"], segs)

    def test_pickup_beats_number_bars_from_the_downbeat_with_from_start(self):
        code, err = self.run_main(self.pickup, "--bars", "2", "--from-start", sync={"pickup_beats": 2})
        self.assertEqual(code, 0, err)
        song = self.song()
        beats = song["beats"]
        self.assertEqual(len(beats), 2 + 2 * 4)
        self.assertEqual([b["bar"] for b in beats], [-1, -1, 0, 0, 0, 0, 1, 1, 1, 1])
        self.assertEqual([b["beat_in_bar"] for b in beats], [2, 3, 0, 1, 2, 3, 0, 1, 2, 3])
        # beat 0 is the first pickup beat: the first click (0.5 s), within a frame of the analyser's ~13 ms bias
        self.assertLess(abs(song["loop"]["start_sec"] - 0.5), 1 / 60 + 0.015, song["loop"]["start_sec"])
        self.assertTrue(song["loop"]["from_start"])
        self.assertAlmostEqual(song["loop"]["duration_sec"], 10 * song["beat_sec"], places=9)
        self.assertEqual(beats[0]["t"], 0.0)

    def test_from_start_without_a_pickup_starts_on_the_first_downbeat(self):
        code, err = self.run_main(self.straight, "--bars", "2", "--start-bar", "0")
        self.assertEqual(code, 0, err)
        bar0 = self.song()["loop"]
        self.assertNotIn("from_start", bar0)
        code, err = self.run_main(self.straight, "--bars", "2", "--from-start")
        self.assertEqual(code, 0, err)
        loop = self.song()["loop"]
        self.assertTrue(loop.pop("from_start"))
        self.assertEqual(loop, bar0)
        self.assertEqual([b["bar"] for b in self.song()["beats"][:4]], [0, 0, 0, 0])
        # pickup_beats without --from-start leaves the loop on whole bars
        code, err = self.run_main(self.pickup, "--bars", "2", "--start-bar", "1", sync={"pickup_beats": 2})
        self.assertEqual(code, 0, err)
        self.assertEqual([b["bar"] for b in self.song()["beats"]], [0] * 4 + [1] * 4)
        for flags in (("--start-bar", "1"), ("--start-near", "3")):
            with self.subTest(flags=flags):
                code, err = self.run_main(self.straight, "--bars", "2", "--from-start", *flags)
                self.assertEqual(code, 2, err)
                self.assertIn("error:", err)

    def test_same_song_json_as_main_without_the_new_fields(self):
        """The analyser on main before C2b (PRE_C2B) and this one write the same song.json, but for `suggestions`."""
        repo = SCRIPTS.parent.parent.parent
        r = subprocess.run(["git", "-C", str(repo), "show", f"{PRE_C2B}:skills/motion-video/scripts/analyze_song.py"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, f"cannot read the pre-C2b analyser ({PRE_C2B}) from git, which this parity "
                                          f"test needs (a full clone of the repo): {r.stderr.strip()}")
        old = self.tmp / "old"
        old.mkdir(exist_ok=True)
        (old / "analyze_song.py").write_text(r.stdout)
        sync = {"nudge_ms": -12, "swing": 0.6, "meter": "4/4", "markers": [{"name": "drop", "t": 9.5, "note": "x"}],
                "checked_by_ear": "2026-10-01"}
        runs = [(self.straight, ("--bars", "4"), None), (self.swing, ("--bars", "3", "--start-near", "6"), None),
                (self.three, ("--bars", "2", "--start-bar", "2"), {"meter": "3/4", "bpm": 150}),
                (self.straight, ("--bars", "2"), sync)]
        for wav, args, s in runs:
            with self.subTest(wav=Path(wav).name, args=args, sync=s):
                got = {}
                for name, script in (("old", old / "analyze_song.py"), ("new", SCRIPTS / "analyze_song.py")):
                    d = self.tmp / f"parity-{name}"
                    shutil.rmtree(d, ignore_errors=True)
                    d.mkdir()
                    if s is not None:
                        (d / "song.json").write_text(json.dumps({"sync": s}))
                    p = subprocess.run([sys.executable, str(script), wav, "--out", str(d), *args],
                                       capture_output=True, text=True)
                    self.assertEqual(p.returncode, 0, p.stderr)
                    got[name] = json.loads((d / "song.json").read_text())
                self.assertIn("suggestions", got["new"])
                got["new"].pop("suggestions")
                self.assertEqual(got["new"], got["old"])


class ClickTrackCliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_cli_writes_a_wav_of_the_asked_length(self):
        out = self.tmp / "beat.wav"
        r = subprocess.run([sys.executable, str(SCRIPTS / "click_track.py"), str(out), "120", "--seconds", "5"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        with wave.open(str(out)) as w:
            self.assertEqual(w.getnframes(), 5 * 44100)

    def test_cli_bad_bpm_is_a_clean_error(self):
        r = subprocess.run([sys.executable, str(SCRIPTS / "click_track.py"), str(self.tmp / "b.wav"), "0"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)
        self.assertIn("error:", r.stderr)
        self.assertNotIn("Traceback", r.stderr)

    def test_cli_out_of_range_input_is_a_clean_error(self):
        # inf BPM looped forever, 1e9 BPM all but hung, --seconds inf raised OverflowError
        for args in (["inf"], ["1e9"], ["120", "--seconds", "inf"]):
            with self.subTest(args=args):
                r = subprocess.run([sys.executable, str(SCRIPTS / "click_track.py"), str(self.tmp / "b.wav"), *args],
                                   capture_output=True, text=True, timeout=20)
                self.assertEqual(r.returncode, 2, r.stderr)
                self.assertIn("error:", r.stderr)
                self.assertNotIn("Traceback", r.stderr)


class ClickTrackShapeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_defaults_are_unchanged(self):
        a = (self.tmp / "a.wav"); b = (self.tmp / "b.wav")
        click_track(a, 120, seconds=10); click_track(b, 120, seconds=10, tempo_map=None, swing=0.5, meter="4/4", pickup=0)
        self.assertEqual(a.read_bytes(), b.read_bytes())
        self.assertEqual(hashlib.sha256(a.read_bytes()).hexdigest(), KNOWN_120_10S)  # computed once on main, pasted here

    def test_beat_times_follow_the_tempo_map(self):
        t = beat_times(90, 40, tempo_map=[(0, 90, False), (20, 120, False)])
        gaps = np.diff(t)
        self.assertAlmostEqual(gaps[0], 60 / 90, places=6)
        self.assertAlmostEqual(gaps[-1], 60 / 120, places=6)
        r = beat_times(100, 40, tempo_map=[(0, 100, False), (20, 100, False), (30, 120, True)])
        g = np.diff(r)
        self.assertTrue(all(g[i] >= g[i + 1] - 1e-9 for i in range(len(g) - 1)), "a ramp up only shortens the gaps")

    def test_cli_options(self):
        out = self.tmp / "s.wav"
        r = subprocess.run([sys.executable, str(SCRIPTS / "click_track.py"), str(out), "100", "--seconds", "12",
                            "--swing", "0.62", "--meter", "3/4", "--pickup", "2", "--tempo-map", "0:100,6:110r"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        bad = subprocess.run([sys.executable, str(SCRIPTS / "click_track.py"), str(out), "100", "--meter", "5/4"], capture_output=True, text=True)
        self.assertEqual(bad.returncode, 2); self.assertNotIn("Traceback", bad.stderr)

    # -- beyond the brief: the shapes later detector tests rely on --

    def _read(self, path):
        with wave.open(str(path)) as w:
            return np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(float) / 32767

    def _kick(self, x, t):
        """55 Hz content in the 0.1 s after t (the hat is broadband noise, so this is ~0 without a kick)."""
        s = int(t * SR); n = int(0.1 * SR)
        return abs(np.dot(x[s:s + n], np.sin(2 * np.pi * 55 * np.arange(n) / SR))) / n

    def _energy(self, x, t):
        s = int(t * SR); return float(np.sum(x[s:s + int(0.02 * SR)] ** 2))

    def test_kicks_follow_meter_and_pickup(self):
        for meter, every, pickup in (("4/4", 4, 0), ("3/4", 3, 2), ("6/8", 2, 1)):
            with self.subTest(meter=meter, pickup=pickup):
                x = self._read(click_track(self.tmp / "m.wav", 100, seconds=12, meter=meter, pickup=pickup))
                beats = beat_times(100, 12)
                kicked = [i for i, b in enumerate(beats) if self._kick(x, b) > 0.1]
                self.assertEqual(kicked, [i for i in range(len(beats)) if i >= pickup and (i - pickup) % every == 0])

    def test_swing_and_compound_hats_land_inside_the_beat(self):
        beats = beat_times(100, 12); iv = 60 / 100
        plain = self._read(click_track(self.tmp / "p.wav", 100, seconds=12))
        swung = self._read(click_track(self.tmp / "s.wav", 100, seconds=12, swing=0.62))
        six = self._read(click_track(self.tmp / "e.wav", 100, seconds=12, meter="6/8"))
        for b in beats[1:-1]:
            self.assertLess(self._energy(plain, b + 0.62 * iv), 1e-3)
            self.assertGreater(self._energy(swung, b + 0.62 * iv), 0.05)
            for frac in (1 / 3, 2 / 3):
                self.assertGreater(self._energy(six, b + frac * iv), 0.05)

    def test_bad_shapes_are_rejected(self):
        for kw in ({"meter": "5/4"}, {"pickup": 4}, {"pickup": 2, "meter": "6/8"}, {"swing": 0.4},
                   {"tempo_map": [(1, 100, False)]}, {"tempo_map": [(0, 100, False), (0, 120, False)]}):
            with self.subTest(**{k: str(v) for k, v in kw.items()}):
                with self.assertRaises(ValueError):
                    click_track(self.tmp / "x.wav", 100, seconds=5, **kw)


if __name__ == "__main__":
    unittest.main()
