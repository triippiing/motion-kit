import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
import extract_theme as E  # noqa: E402

FINANCE_LIKE = """
/* palette */
:root{
  --bg:#eef0f3; --panel:#ffffff; --panel-2:#f6f7f9;
  --ink:#161a21; --muted:#697082;
  --accent:#0c7d74; --pos:#067647;
}
@media (prefers-color-scheme:dark){ :root{ --bg:#171a20; --ink:#eef0f4; } }
body{margin:0;font-family:-apple-system, "SF Pro Text", sans-serif}
"""


class ExtractThemeTests(unittest.TestCase):
    def test_reads_light_theme_roles_and_body_font(self):
        theme, warnings = E.extract(FINANCE_LIKE)
        self.assertEqual(theme["canvas"], "#eef0f3")
        self.assertEqual(theme["surface"], "#ffffff")
        self.assertEqual(theme["ink"], "#161a21")
        self.assertEqual(theme["muted"], "#697082")
        self.assertEqual(theme["accent"], "#0c7d74")
        self.assertIn("-apple-system", theme["font"])
        self.assertEqual(warnings, [])

    def test_resolves_var_references(self):
        theme, _ = E.extract(":root{--teal:#0C7D74;--primary:var(--teal);--background:#fff;--text:#111;}")
        self.assertEqual(theme["accent"], "#0c7d74")
        self.assertEqual(theme["canvas"], "#ffffff")
        self.assertEqual(theme["ink"], "#111111")

    def test_normalises_rgb(self):
        theme, _ = E.extract(":root{--bg: rgb(10, 20, 30); --accent: rgba(255,0,0,.5);}")
        self.assertEqual(theme["canvas"], "#0a141e")
        self.assertEqual(theme["accent"], "#ff0000")

    def test_missing_roles_fall_back_to_house_with_a_warning(self):
        theme, warnings = E.extract(":root{--accent:#123456}")
        self.assertEqual(theme["accent"], "#123456")
        self.assertEqual(theme["canvas"], E.HOUSE["canvas"])
        self.assertTrue(any("canvas" in w for w in warnings))

    def test_map_override(self):
        theme, _ = E.extract(FINANCE_LIKE, {"accent": "--pos"})
        self.assertEqual(theme["accent"], "#067647")

    def test_cli_house_theme_and_errors(self):
        out = Path(tempfile.mkdtemp())
        r = subprocess.run([sys.executable, str(SCRIPTS / "extract_theme.py"), "--out", str(out)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads((out / "theme.json").read_text()), E.HOUSE)
        self.assertIn("--accent:", (out / "theme.css").read_text())
        r = subprocess.run([sys.executable, str(SCRIPTS / "extract_theme.py"), str(out / "nope.css"), "--out", str(out)],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)
        self.assertIn("no such file", r.stderr)

    def test_real_finance_css_if_present(self):
        css = Path.home() / "Documents/AUTOMATION/personal-finance/web/style.css"
        if not css.exists():
            self.skipTest("finance app not on this machine")
        theme, _ = E.extract(css.read_text())
        self.assertEqual(theme["accent"], "#0c7d74")
        self.assertEqual(theme["canvas"], "#eef0f3")


if __name__ == "__main__":
    unittest.main()
