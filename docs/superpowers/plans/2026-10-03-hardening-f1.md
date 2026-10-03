# Hardening F1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix what a fresh clone of motion-kit hits first (leaking test temp dirs, a script importing from tests, a fragile entry guard, a Save that can hang, a short loop clip) and ship it before the 2026-10-05 launch.

**Architecture:** One test helper (`tests/tmp.mjs`) owns every test temp dir and removes them at process exit. Project scaffolding and the click track move from `tests/` into `scripts/` (`scaffold.mjs`, `click_track.py`) so `gallery.mjs` depends only on scripts. A shared `scripts/is_main.mjs` replaces eight copies of the entry guard. `sync.mjs` gets a killable, timed analyser run. `analyze_song.py` prefers windows inside the song for every grid and pads the clip to its exact length.

**Tech Stack:** Node 22+ (node:test, ES modules), Python 3 + numpy (unittest), ffmpeg, Playwright Chromium (existing).

**Spec:** `docs/superpowers/specs/2026-10-03-hardening-f1-design.md`

All paths below are relative to `~/motion-kit`. `MV=skills/motion-video`. Work on branch `hardening-f1` (create it from `main` before Task 1: `git switch -c hardening-f1`).

## Global Constraints

- Scripts fail with `error: ...` and exit 2 on bad input, never a traceback (CLAUDE.md Conventions).
- No new dependencies: Node built-ins, Python stdlib + numpy, ffmpeg.
- Match the surrounding code's comment density and idiom (short `//` or `#` comments saying why).
- No render may change: frame times, states and existing projects' `song.json` stay the same (spec success item 6).
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The full suite is `npm test` from the repo root (Node suites + Python unittest; a few minutes, uses Chromium).
- ffmpeg is at `/opt/homebrew/bin` (the scripts add it to PATH; for ad-hoc shell use `export PATH=/opt/homebrew/bin:$PATH`).

## Review Focus

1. A test file that crashes (uncaught exception) must still remove its temp dirs. Pinned in Task 1 (`throw` child test).
2. Skills are installed as symlinks (`~/.claude/skills/motion-video -> clone`), so `isMain` must be true when `argv[1]` is a symlink to the script. Pinned in Task 3.
3. An analyser that ignores SIGTERM (or leaves a child process holding its pipes) must not hang Save. Pinned in Task 4 (`trap '' TERM` test; process-group kill).
4. A junk `MK_ANALYSER_TIMEOUT` (`abc`, `0`, `-1`) must fall back to 120 s, not disable the timeout or time out instantly. Pinned in Task 4.
5. `gallery.mjs OUT` must leave no temp project behind, while `gallery.mjs` with no OUT and no `--stills` still prints a usable project path (that project is its output). Pinned in Task 2.

---

### Task 1: `tempDir` helper and every test temp dir on it

**Files:**
- Create: `$MV/tests/tmp.mjs`
- Create: `$MV/tests/tmp.test.mjs`
- Modify: `$MV/tests/harness.mjs:5-6,15` (temp root)
- Modify: `$MV/tests/fixtures.mjs:1-3,9`
- Modify: `$MV/tests/render.test.mjs:56,72,86,117,279` (the `np-`, `tpl-`, `sz-`, `tp-`, `sp-` mkdtemps)
- Modify: `$MV/tests/recipes.test.mjs:63`
- Modify: `$MV/tests/symlink_cli.test.mjs:12`
- Modify: `$MV/tests/export.test.mjs:18,237,352`
- Modify: `tests/install.test.mjs:12,22`
- Modify: `$MV/tests/test_extract_theme.py:82,93`

**Interfaces:**
- Produces: `tempDir(prefix = 'mk-') -> string` (absolute path of a new, empty directory, removed when the process exits) exported from `$MV/tests/tmp.mjs`. Task 2, 3 and 4 tests import it.

- [ ] **Step 1: Write the failing test** — `$MV/tests/tmp.test.mjs`:

```js
// tmp.test.mjs -- tempDir removes its directories when the test process ends: normally, on a crash and on SIGINT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TMP = pathToFileURL(path.join(import.meta.dirname, 'tmp.mjs')).href;
const prelude = `import { tempDir } from ${JSON.stringify(TMP)}; import { writeFileSync } from 'node:fs';`;
const args = (body) => ['--input-type=module', '-e', `${prelude}\n${body}`];
const child = (body, env = {}) => spawnSync(process.execPath, args(body), { encoding: 'utf8', env: { ...process.env, ...env } });
const MAKE = "const d = tempDir('mk-tmptest-'); writeFileSync(d + '/f', 'x'); console.log(d);";

test('a normal exit removes the directory', () => {
  const r = child(MAKE);
  assert.equal(r.status, 0, r.stderr);
  const d = r.stdout.trim();
  assert.match(path.basename(d), /^mk-tmptest-/);
  assert.equal(existsSync(d), false);
});

test('an uncaught exception still removes the directory', () => {
  const r = child(`${MAKE} throw new Error('boom');`);
  assert.equal(r.status, 1);
  assert.equal(existsSync(r.stdout.trim()), false);
});

test('SIGINT removes the directory and exits 130', async () => {
  const c = spawn(process.execPath, args(`${MAKE} setInterval(() => {}, 1000);`));
  const d = await new Promise((resolve) => c.stdout.once('data', (b) => resolve(String(b).trim())));
  assert.equal(existsSync(d), true);
  const code = await new Promise((resolve) => { c.on('exit', (code) => resolve(code)); c.kill('SIGINT'); });
  assert.equal(code, 130);
  assert.equal(existsSync(d), false);
});

test('MK_KEEP_TMP=1 keeps the directory and names it on stderr', () => {
  const r = child(MAKE, { MK_KEEP_TMP: '1' });
  const d = r.stdout.trim();
  try {
    assert.equal(existsSync(d), true);
    assert.ok(r.stderr.includes(d), r.stderr);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test $MV/tests/tmp.test.mjs`
Expected: FAIL (`Cannot find module .../tmp.mjs`).

- [ ] **Step 3: Write `$MV/tests/tmp.mjs`**

```js
// tmp.mjs -- temp directories for tests, removed when the test process ends (normally, on a crash, or on
// SIGINT/SIGTERM). node --test runs each file in its own process, so every file cleans up after itself.
// MK_KEEP_TMP=1 keeps them and lists them on stderr, for a look after a failure.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const made = [];
let installed = false;

function cleanup() {
  if (process.env.MK_KEEP_TMP === '1') {
    if (made.length) process.stderr.write(`kept temp dirs (MK_KEEP_TMP=1):\n${made.splice(0).join('\n')}\n`);
    return;
  }
  for (const d of made.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
}

export function tempDir(prefix = 'mk-') {
  if (!installed) {
    installed = true;
    process.on('exit', cleanup);
    // a handler replaces the default exit on these signals, so exit with the shell's code for them
    for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.on(sig, () => { cleanup(); process.exit(code); });
  }
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  made.push(d);
  return d;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test $MV/tests/tmp.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Move every test temp dir onto `tempDir`**

In each file add `import { tempDir } from './tmp.mjs';` (in `tests/install.test.mjs`: `from '../skills/motion-video/tests/tmp.mjs'`), make these replacements, then drop `mkdtempSync` / `tmpdir` from that file's imports only if `grep -n 'mkdtempSync\|tmpdir' FILE` shows no other use (`render.test.mjs` keeps `tmpdir` for its `path.join(tmpdir(), 'x')` and `'never-made'` paths).

| File | Old | New |
|---|---|---|
| `harness.mjs:15` | `const root = mkdtempSync(path.join(tmpdir(), 'mk-'));` | `const root = tempDir('mk-');` |
| `fixtures.mjs:9` | `path.join(mkdtempSync(path.join(tmpdir(), 'mv-')), name)` | `path.join(tempDir('mv-'), name)` |
| `render.test.mjs` | `mkdtempSync(path.join(tmpdir(), 'np-'))` (and `'tpl-'`, `'sz-'`, `'tp-'`, `'sp-'`) | `tempDir('np-')` (and `'tpl-'`, `'sz-'`, `'tp-'`, `'sp-'`) |
| `recipes.test.mjs:63` | `mkdtempSync(path.join(tmpdir(), 'tag-'))` | `tempDir('tag-')` |
| `symlink_cli.test.mjs:12` | `mkdtempSync(path.join(tmpdir(), 'mk-symlink-'))` | `tempDir('mk-symlink-')` |
| `export.test.mjs:18,237,352` | `mkdtempSync(path.join(tmpdir(), 'mk-export-'))`, `'mk-skill-'`, `'mk-symlink-'` | `tempDir('mk-export-')`, `tempDir('mk-skill-')`, `tempDir('mk-symlink-')` (keep its `temps` list and `after()`; harmless) |
| `tests/install.test.mjs:12,22` | `mkdtempSync(path.join(tmpdir(), 'skills-'))` | `tempDir('skills-')` |

In `$MV/tests/test_extract_theme.py`, after each `out = Path(tempfile.mkdtemp())` (lines 82 and 93) add:

```python
        self.addCleanup(shutil.rmtree, out, ignore_errors=True)
```

and add `import shutil` to its imports if it is not there.

- [ ] **Step 6: Run the suites that changed, then count leaks over a full run**

Run:
```bash
count() { ls -d "${TMPDIR:-/tmp}"/{mk-,mv-,np-,tpl-,sz-,tp-,sp-,tag-,skills-}* 2>/dev/null | wc -l; }
before=$(count); npm test; after=$(count); echo "before=$before after=$after"
```
Expected: all green; `after` equals `before`. (Gallery's CLI still leaks until Task 2, but no test runs its CLI past argument checks.)

- [ ] **Step 7: Commit**

```bash
git add $MV/tests tests/install.test.mjs
git commit -m "tests: tempDir removes every test temp dir when the process ends (MK_KEEP_TMP=1 keeps them)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Click track and scaffolding move to `scripts/`; gallery off the test harness

**Files:**
- Create: `$MV/scripts/click_track.py`
- Create: `$MV/scripts/scaffold.mjs`
- Modify: `$MV/tests/test_analyze_song.py:18-44` (click_track becomes an import)
- Modify: `$MV/tests/harness.mjs:1-30`
- Modify: `$MV/tests/render.test.mjs` (four `python3 -c ... from test_analyze_song import click_track` blocks)
- Modify: `$MV/scripts/gallery.mjs:11,17-31,52-80`
- Modify: `$MV/tests/gallery.test.mjs:13` plus two new tests
- Modify: `CLAUDE.md:113,314`, and `$MV/SKILL.md` wherever `test_analyze_song` appears

**Interfaces:**
- Consumes: `tempDir(prefix)` from `$MV/tests/tmp.mjs` (Task 1).
- Produces:
  - `python3 $MV/scripts/click_track.py OUT BPM [--seconds S]` (default 40), and `click_track(path, bpm, seconds=40.0, offset=0.37, noise=0.001, hat=0.3, seed=0) -> path` plus `SR = 44100` importable from `click_track`.
  - `clickTrack(file, bpm = 120, seconds = 40) -> file` and `scaffold(root, { states, cursor, bars = 4, bpm = 120, extraSfx = '[]', content = '{}', size }) -> projectDir` (`root/p`; the song is `root/beat.wav`) from `$MV/scripts/scaffold.mjs`.
  - `gallery({ only = null, root }) -> { dir, list, plays }`: `root` is required (the directory to build in).
  - `makeProject(opts)` in `harness.mjs` unchanged for callers.

- [ ] **Step 1: Write the failing tests**

Add to `$MV/tests/test_analyze_song.py` (new class at the end of the file):

```python
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
```

Add to `$MV/tests/gallery.test.mjs`:

```js
test('gallery.mjs imports nothing from tests/', () => {
  const src = readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'gallery.mjs'), 'utf8');
  assert.doesNotMatch(src, /from '\.\.\/tests\//);
});

test('gallery OUT leaves no temp project behind', () => {
  const temps = () => readdirSync(tmpdir()).filter((n) => n.startsWith('mk-gallery-')).sort();
  const out = path.join(tempDir('mk-gout-'), 'g');
  const before = temps();
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'scripts', 'gallery.mjs'), out, '--only', 'button'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(path.join(out, 'index.html')), 'the project is in OUT');
  assert.deepEqual(temps(), before);
});
```

with imports `existsSync, readdirSync` from `node:fs`, `tmpdir` from `node:os`, and `tempDir` from `./tmp.mjs`.

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest discover -s $MV/tests -p 'test_analyze_song.py' -k ClickTrack` → FAIL (no `click_track.py`).
Run: `node --test --test-name-pattern='gallery' $MV/tests/gallery.test.mjs` → the two new tests FAIL (the import is there; a `mk-` dir is left behind).

- [ ] **Step 3: Create `$MV/scripts/click_track.py`** (the function body moves verbatim from the test file)

```python
#!/usr/bin/env python3
"""click_track.py OUT BPM [--seconds 40] -- a synthetic beat: a hi-hat-like click on every beat and a 55 Hz kick
on each downbeat (every 4th). For tests, the gallery, and trying the kit with no music to hand."""
import argparse
import sys
import wave

import numpy as np

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


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("out")
    ap.add_argument("bpm", type=float)
    ap.add_argument("--seconds", type=float, default=40.0)
    a = ap.parse_args(argv)
    if not (a.bpm > 0 and a.seconds > 0):
        ap.error("BPM and --seconds must be positive")
    try:
        click_track(a.out, a.bpm, seconds=a.seconds)
    except OSError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

`chmod +x $MV/scripts/click_track.py`. In `test_analyze_song.py`, delete `SR = 44100` and the whole `def click_track(...)` (lines 18-44) and put after `import analyze_song as A  # noqa: E402`:

```python
from click_track import SR, click_track  # noqa: E402,F401  (also imported from here by older commands)
```

- [ ] **Step 4: Create `$MV/scripts/scaffold.mjs`** (moved from `harness.mjs`)

```js
// scaffold.mjs -- a real project from given tables on a synthetic click track (the gallery and the tests use it).
// Tables are JS source strings (so they can use END), spliced into the template's table block.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const START = '// ---------------- the three tables you edit ----------------';
const END_MARK = '// ------------------------------------------------------------';

// A click track at BPM in FILE (click_track.py); returns FILE.
export function clickTrack(file, bpm = 120, seconds = 40) {
  execFileSync('python3', [path.join(HERE, 'click_track.py'), file, String(bpm), '--seconds', String(seconds)], { stdio: 'pipe' });
  return file;
}

// Builds ROOT/beat.wav and the project ROOT/p (ROOT is created if needed); returns the project directory.
export function scaffold(root, { states, cursor, bars = 4, bpm = 120, extraSfx = '[]', content = '{}', size } = {}) {
  mkdirSync(root, { recursive: true });
  const song = clickTrack(path.join(root, 'beat.wav'), bpm, Math.ceil((bars * 4 * 60) / bpm) + 12);
  const dir = path.join(root, 'p');
  execFileSync(path.join(HERE, 'new_project.sh'), [dir, song, '--bars', String(bars), ...(size ? ['--size', size] : [])], { stdio: 'pipe' });
  if (states) {
    const f = path.join(dir, 'index.html'), html = readFileSync(f, 'utf8');
    const a = html.indexOf(START), b = html.indexOf(END_MARK, a);
    if (a < 0 || b < 0) throw new Error(`scaffold: template table markers not found in ${f} (expected "${START}" then "${END_MARK}")`);
    const tables = `${START}\nconst states = () => ${states};\nconst cursor = () => ${cursor};\nconst extraSfx = () => ${extraSfx};\nconst content = ${content};\n`;
    writeFileSync(f, html.slice(0, a) + tables + html.slice(b));
  }
  return dir;
}
```

Check nothing matched the old message: `grep -rn "harness: template" $MV/tests` (expect none; if found, change it to `scaffold: template`).

- [ ] **Step 5: Slim `harness.mjs`**

Replace its header and `makeProject` (lines 1-30) with:

```js
// harness.mjs -- scaffold a real project with given tables in a temp dir and open it in Chromium.
import assert from 'node:assert/strict';
import { openProject } from '../scripts/render.mjs';
import { scaffold } from '../scripts/scaffold.mjs';
import { tempDir } from './tmp.mjs';

export const makeProject = (opts) => scaffold(tempDir('mk-'), opts);
```

Keep `openScene`, `scene` and `noFlash` as they are.

- [ ] **Step 6: render.test.mjs uses `clickTrack`**

Add `import { clickTrack } from '../scripts/scaffold.mjs';`. Replace each of the four blocks

```js
  execFileSync('python3', ['-c', `
import sys; sys.path.insert(0, ${JSON.stringify(path.join(SKILL, 'tests'))})
from test_analyze_song import click_track
click_track(${JSON.stringify(song)}, 120)`]);
```

with `clickTrack(song, 120);`. (Its local `function scaffold()` stays; it does not clash because only `clickTrack` is imported.)

- [ ] **Step 7: gallery builds in a root it is given; the CLI cleans up**

In `$MV/scripts/gallery.mjs`: replace `import { makeProject } from '../tests/harness.mjs';` with `import { scaffold } from './scaffold.mjs';`, add `mkdtempSync, rmSync` to the `node:fs` import and `import { tmpdir } from 'node:os';`. Change `gallery`:

```js
// Builds the gallery project inside ROOT (a directory the caller owns and removes).
export async function gallery({ only = null, root } = {}) {
  if (!root) throw new Error('gallery: root (the directory to build the project in) is required');
  ...                                   // body unchanged down to the cursor line
  const dir = scaffold(root, { states, cursor, bars });
  return { dir, list, plays };
}
```

Replace the CLI body from `const { dir, plays } = await gallery({ only });` to the final `console.log(dir);` with:

```js
  // With no OUT and no --stills the project itself is the output, so it stays and its path is printed.
  const root = mkdtempSync(path.join(tmpdir(), 'mk-gallery-'));
  const keep = !out && !stills;
  try {
    const { dir, plays } = await gallery({ only, root });
    if (out) execFileSync('cp', ['-R', dir + '/.', out]);
    if (stills) {
      // ... the existing stills block, unchanged ...
    }
    console.log(out ?? (stills ? path.join(COMP, 'docs-images') : dir));
  } finally {
    if (!keep) rmSync(root, { recursive: true, force: true });
  }
```

In `gallery.test.mjs` line 13: `const { dir, plays } = await gallery({ root: tempDir('mk-gallery-') });`.

- [ ] **Step 8: Docs for the moved click track**

`CLAUDE.md:113`, replace the python one-liner with:

```bash
python3 <clone>/skills/motion-video/scripts/click_track.py beat.wav 120 --seconds 30
```

`CLAUDE.md:314`: `(`test_analyze_song.click_track`)` becomes `(`scripts/click_track.py`)`. Code map, the `scripts/` entry: add `click_track.py (synthetic beat), scaffold.mjs (a project from tables on a click track; gallery + tests)`. Run `grep -rn "test_analyze_song\|harness" CLAUDE.md README.md $MV/SKILL.md skills/motion-design` and point any remaining instruction at the new script the same way.

- [ ] **Step 9: Run the tests**

Run: `python3 -m unittest discover -s $MV/tests -p 'test_*.py'` → PASS.
Run: `node --test $MV/tests/gallery.test.mjs $MV/tests/render.test.mjs $MV/tests/sync.test.mjs $MV/tests/button.test.mjs` → PASS.

- [ ] **Step 10: Commit**

```bash
git add $MV/scripts/click_track.py $MV/scripts/scaffold.mjs $MV/scripts/gallery.mjs $MV/tests CLAUDE.md $MV/SKILL.md
git commit -m "scripts: click_track.py and scaffold.mjs move out of tests; gallery no longer imports the test harness and cleans up its temp project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: One entry guard, `isMain`

**Files:**
- Create: `$MV/scripts/is_main.mjs`
- Create: `$MV/tests/is_main.test.mjs`
- Modify (the guard line in each): `$MV/scripts/beat_stills.mjs:68`, `build_catalog.mjs:68`, `check_brief.mjs:155`, `export.mjs:301`, `gallery.mjs` (guard), `render.mjs:397`, `safezones.mjs:210`, `sync.mjs:247`

**Interfaces:**
- Consumes: `tempDir` (Task 1).
- Produces: `isMain(metaUrl, argv1 = process.argv[1]) -> boolean` from `$MV/scripts/is_main.mjs`.

- [ ] **Step 1: Write the failing test** — `$MV/tests/is_main.test.mjs`:

```js
// is_main.test.mjs -- the shared "run as a script?" guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../scripts/is_main.mjs';
import { tempDir } from './tmp.mjs';

const SCRIPTS = path.join(import.meta.dirname, '..', 'scripts');

test('isMain: its own path, through a symlink, a missing path, no argv[1]', () => {
  const self = fileURLToPath(import.meta.url);
  assert.equal(isMain(import.meta.url, self), true);
  const link = path.join(tempDir('mk-ismain-'), 'link.mjs');
  symlinkSync(self, link);   // install.sh links the skills, so scripts often run through a symlink
  assert.equal(isMain(import.meta.url, link), true);
  assert.equal(isMain(import.meta.url, path.join(SCRIPTS, 'render.mjs')), false);
  assert.equal(isMain(import.meta.url, '/nope/never/x.mjs'), false);
  assert.equal(isMain(import.meta.url, undefined), false);
});

test('no script repeats the old realpathSync(process.argv[1]) guard', () => {
  for (const f of readdirSync(SCRIPTS).filter((n) => n.endsWith('.mjs'))) {
    assert.doesNotMatch(readFileSync(path.join(SCRIPTS, f), 'utf8'), /realpathSync\(process\.argv\[1\]\)/, f);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test $MV/tests/is_main.test.mjs` → FAIL (no `is_main.mjs`).

- [ ] **Step 3: Write `$MV/scripts/is_main.mjs`**

```js
// is_main.mjs -- true when the module at metaUrl is the script node was started with. Compares real paths, so it
// holds through the skill symlinks; a missing or unresolvable argv[1] is "no" rather than an ENOENT crash.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMain(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try { return realpathSync(argv1) === realpathSync(fileURLToPath(metaUrl)); } catch { return false; }
}
```

- [ ] **Step 4: Use it in all eight scripts**

In each of the eight files replace

```js
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
```

with

```js
if (isMain(import.meta.url)) {
```

and add `import { isMain } from './is_main.mjs';` beside the other local imports. Then for each file run `grep -n 'realpathSync\|fileURLToPath' FILE` and remove a name from its import only when nothing else in the file uses it (render.mjs, build_catalog.mjs, check_brief.mjs and gallery.mjs still use `fileURLToPath`).

- [ ] **Step 5: Run the tests**

Run: `node --test $MV/tests/is_main.test.mjs $MV/tests/render.test.mjs $MV/tests/symlink_cli.test.mjs $MV/tests/export.test.mjs $MV/tests/gallery.test.mjs $MV/tests/check_brief.test.mjs $MV/tests/sync.test.mjs $MV/tests/beat_stills.test.mjs $MV/tests/safezones.test.mjs` → PASS (the existing CLI tests prove every script still runs as a command, including from a path with spaces and through a symlink).

- [ ] **Step 6: Commit**

```bash
git add $MV/scripts $MV/tests/is_main.test.mjs
git commit -m "scripts: one isMain guard (no ENOENT on a missing argv[1]; works through symlinks)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Save stops a hung analyser

**Files:**
- Modify: `$MV/scripts/sync.mjs` (`run()` ~line 54, `doSave` ~line 77, `saveSync` ~line 134, header comment)
- Modify: `$MV/tests/sync.test.mjs` (three tests)
- Modify: `CLAUDE.md` Syncing section, `$MV/SKILL.md` Sync section

**Interfaces:**
- Consumes: `tempDir` (Task 1); `project()`, `read()` helpers already in `sync.test.mjs`.
- Produces: `saveSync(dir, sync, { python = 'python3', timeoutMs = analyserTimeout() })`; `analyserTimeout(env = process.env) -> number` (ms) exported from `sync.mjs`.

- [ ] **Step 1: Write the failing tests** — add to `$MV/tests/sync.test.mjs` (import `chmodSync` from `node:fs`, `analyserTimeout` from `../scripts/sync.mjs`, `tempDir` from `./tmp.mjs`):

```js
// A stand-in for python3 that runs a shell body instead of the analyser.
function fakePython(body) {
  const f = path.join(tempDir('mk-fakepy-'), 'python3');
  writeFileSync(f, `#!/bin/sh\n${body}\n`);
  chmodSync(f, 0o755);
  return f;
}

test('Save: a hung analyser is stopped after the timeout; song.json is unchanged and the next Save runs', async () => {
  const dir = project();
  const before = read(dir, 'song.json');
  const e = await saveSync(dir, { nudge_ms: -10 }, { python: fakePython('sleep 30'), timeoutMs: 300 }).catch((x) => x);
  assert.ok(e instanceof SaveError, String(e));
  assert.equal(e.message, 'the analyser took longer than 0.3 s and was stopped; song.json is unchanged');
  assert.deepEqual(read(dir, 'song.json'), before);
  const { song: next } = await saveSync(dir, { nudge_ms: -10 });
  assert.equal(next.sync.nudge_ms, -10);
});

test('Save: an analyser that ignores SIGTERM is killed', async () => {
  const dir = project();
  const t0 = Date.now();
  const e = await saveSync(dir, { nudge_ms: -10 }, { python: fakePython("trap '' TERM\nsleep 30"), timeoutMs: 300 }).catch((x) => x);
  assert.ok(e instanceof SaveError, String(e));
  assert.ok(Date.now() - t0 < 10_000, `took ${Date.now() - t0} ms`);
});

test('analyserTimeout: MK_ANALYSER_TIMEOUT in ms, else 120 s', () => {
  assert.equal(analyserTimeout({}), 120_000);
  assert.equal(analyserTimeout({ MK_ANALYSER_TIMEOUT: '5000' }), 5000);
  for (const bad of ['abc', '0', '-1', '']) assert.equal(analyserTimeout({ MK_ANALYSER_TIMEOUT: bad }), 120_000, bad);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-name-pattern='timeout|SIGTERM|hung' $MV/tests/sync.test.mjs`
Expected: FAIL (`analyserTimeout` is not exported; the hung test runs for 30 s first).

- [ ] **Step 3: Implement in `sync.mjs`**

Replace `run()` with:

```js
// Runs a command; resolves { code, stdout, stderr, timedOut } (code null and `error` set when it could not start).
// After timeoutMs the whole process group gets SIGTERM, then SIGKILL 2 s later: a child of the command could
// otherwise hold its pipes open and keep 'close' from ever firing.
function run(cmd, args, { timeoutMs = 0 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { detached: true, env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}` } });
    let stdout = '', stderr = '', timedOut = false, killer = null;
    const signal = (sig) => { try { process.kill(-child.pid, sig); } catch { /* already gone */ } };
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      signal('SIGTERM');
      killer = setTimeout(() => signal('SIGKILL'), 2000);
    }, timeoutMs) : null;
    const done = (r) => { clearTimeout(timer); clearTimeout(killer); resolve({ ...r, timedOut }); };
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (error) => done({ code: null, stdout, stderr, error }));
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

// How long Save lets the analyser run: MK_ANALYSER_TIMEOUT (ms) when it is a positive number, else 120 s.
export function analyserTimeout(env = process.env) {
  const ms = Number(env.MK_ANALYSER_TIMEOUT);
  return env.MK_ANALYSER_TIMEOUT && Number.isFinite(ms) && ms > 0 ? ms : 120_000;
}
```

(Keep the existing stdout/stderr handler lines if they already match; the point is `detached`, the timer and `timedOut`.)

`doSave(root, sync, python)` becomes `doSave(root, sync, python, timeoutMs)`; pass `{ timeoutMs }` to `run(...)`, and right after the call, before `if (r.code !== 0)`, add:

```js
    if (r.timedOut) {
      await rename(bakTmp, songFile);
      throw new SaveError(`the analyser took longer than ${+(timeoutMs / 1000).toFixed(1)} s and was stopped; song.json is unchanged`);
    }
```

`saveSync`:

```js
export function saveSync(dir, sync, { python = 'python3', timeoutMs = analyserTimeout() } = {}) {
  const root = path.resolve(dir);
  const next = (chains.get(root) ?? Promise.resolve()).then(() => doSave(root, sync, python, timeoutMs));
```

Add to the comment block above `saveSync`: `An analyser still running after timeoutMs (MK_ANALYSER_TIMEOUT, default 120 s) is stopped: a SaveError, files as they were.`

- [ ] **Step 4: Run the tests**

Run: `node --test $MV/tests/sync.test.mjs $MV/tests/sync-page.test.mjs` → PASS.

- [ ] **Step 5: Docs**

CLAUDE.md, Syncing, the **Save** bullet: append `If the analyser runs longer than 120 s (MK_ANALYSER_TIMEOUT, in ms, changes it), Save stops it and reports the error with the files unchanged.` Add the same sentence to the Save description in `$MV/SKILL.md` (`grep -n "Save" $MV/SKILL.md` to find it).

- [ ] **Step 6: Commit**

```bash
git add $MV/scripts/sync.mjs $MV/tests/sync.test.mjs CLAUDE.md $MV/SKILL.md
git commit -m "sync: Save stops an analyser that runs past 120 s (MK_ANALYSER_TIMEOUT) and keeps the files as they were

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The loop window stays inside the song; the clip is always full length

**Files:**
- Modify: `$MV/scripts/analyze_song.py:240-260` (window choice, overrun), warnings block (~line 283), `write_clip` (~line 320)
- Modify: `$MV/tests/test_analyze_song.py` (`AnalyzeTests`, three tests)
- Modify: `CLAUDE.md` (the loop window bullet)

**Interfaces:**
- Produces: `song["rules"]["warnings"]` may contain `the loop runs N ms past the end of the song; clip.wav is padded with silence`; `clip.wav` always has `round(duration_sec * 48000)` samples (±1).

- [ ] **Step 0: Record the baseline for the demo check (Task 6)**

```bash
SCR=$(mktemp -d); echo $SCR > .git/f1-baseline-dir      # kept out of the work tree
git show main:$MV/scripts/analyze_song.py > $SCR/analyze_song_old.py   # self-contained (stdlib + numpy)
```

- [ ] **Step 1: Write the failing tests** — add to `AnalyzeTests` in `test_analyze_song.py`:

```python
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest discover -s $MV/tests -p 'test_analyze_song.py' -k overrun -k past_the_end -k padding`
Expected: `test_free_pick_skips_windows_past_the_end` FAILS (the old pick ends at ~22.38 s for a 21.97 s song), `test_forced_overrun_pads_the_clip_and_warns` FAILS (no warning), `test_no_padding_warning_when_the_loop_fits` passes.

- [ ] **Step 3: Implement in `analyze_song.py`**

Window choice (the `else:` branch around line 240):

```python
    else:
        # prefer windows inside the song: a grid's first or last bar can sit past the audio
        # (a nudge, or just the detected last bar); if none fits, every window is a candidate
        fits = [b for b in range(last_start + 1)
                if times[j + b * bpb] >= 0 and times[j + b * bpb] + duration <= song_sec]
```

(the `fits = fits or ...`, `score`, `preferred`, `start = ...` lines stay.)

Replace the overrun comment and check after `start_sec` (around line 257):

```python
    overrun = start_sec + duration - song_sec
    # a user grid is held to the song; a detected one may end past it (the clip is then padded, with a warning)
    if user_grid and overrun > 0:
        raise SongError("the loop window would end past the end of the song (move it with --start-bar); "
                        "--start-near SEC also moves the loop window")
```

In the warnings block, after the `confidence` warning:

```python
    if overrun >= 0.001:
        warnings.append(f"the loop runs {overrun * 1000:.0f} ms past the end of the song; clip.wav is padded with silence")
```

`write_clip`:

```python
def write_clip(src, start_sec, duration_sec, out_path):
    # pad with silence to the exact loop length (a loop can end past the song), then fade both ends
    af = (f"apad=whole_dur={duration_sec:.6f},afade=t=in:d=0.01,"
          f"afade=t=out:st={duration_sec - 0.01:.6f}:d=0.01")
    r = subprocess.run([ffmpeg_bin(), "-v", "error", "-y", "-ss", f"{start_sec:.6f}", "-i", str(src),
                        "-t", f"{duration_sec:.6f}", "-af", af, "-ar", "48000", "-ac", "2",
                        "-c:a", "pcm_s16le", str(out_path)], capture_output=True)
```

(the rest of `write_clip` unchanged).

- [ ] **Step 4: Run the Python suite**

Run: `PATH=/opt/homebrew/bin:$PATH python3 -m unittest discover -s $MV/tests -p 'test_*.py'` → PASS.

- [ ] **Step 5: Docs**

CLAUDE.md, the "The loop window" bullet: after "preferring one that starts on a detected section boundary" add `and one that ends inside the song`, and append the sentence `A window that still runs past the song's end (chosen with --start-bar or --start-near) gets a silence-padded clip.wav and a warning.`

- [ ] **Step 6: Commit**

```bash
git add $MV/scripts/analyze_song.py $MV/tests/test_analyze_song.py CLAUDE.md
git commit -m "analyze_song: pick a loop window inside the song for every grid; pad clip.wav to the loop length with a warning

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Verify, document, merge

**Files:**
- Modify: `CLAUDE.md` (Testing: `MK_KEEP_TMP`; code map: `is_main.mjs`)
- Modify: `docs/superpowers/deferred.md` (F1 items done; pickup moved to C2)

- [ ] **Step 1: Docs**

CLAUDE.md Testing section, after the `npm test` block add: `Test temp dirs are removed when each test file ends; MK_KEEP_TMP=1 npm test keeps them (their paths are printed) for a look after a failure.` Code map `scripts/` entry: add `is_main.mjs (the entry guard every script uses)`. In `docs/superpowers/deferred.md`, under Tooling, remove the "Script entry guards throw ENOENT" and "gallery.mjs imports tests/harness.mjs ... makeProject temp dirs are not cleaned up" lines and add at the top: `F1 (2026-10-03) fixed temp-dir leaks, the gallery's test import, the entry guard, the Save timeout and the analyser's last-bar overrun. Pickup/anacrusis support moved to C2.`

- [ ] **Step 2: Demo check (spec success item 6)**

For each project, re-run old and new analysers on a scratch copy, as Save does (`--start-near` the stored loop start) and as a fresh pick, and diff:

```bash
export PATH=/opt/homebrew/bin:$PATH
SCR=$(cat .git/f1-baseline-dir); NEW=$MV/scripts/analyze_song.py
cp $SCR/analyze_song_old.py $SCR/analyze_song.py
TINTS="$HOME/Desktop/Tints (feat. Kendrick Lamar).flac"; TEASE="$HOME/Downloads/2000s-x-90s-RB-Pop-Pharrell-Type-Beat---Tease-Me.mp3"
for pair in "demos/01-reference|$TINTS" "demos/02-finance-promo|$TINTS" "demos/04-library-reference|$TINTS" \
            "$HOME/motion-kit-launch/kit|$TEASE" "$HOME/motion-kit-launch/finance|$TEASE" "$HOME/motion-kit-launch/end|$TEASE"; do
  P=${pair%%|*}; S=${pair#*|}
  read B F ST <<<"$(python3 -c "import json;s=json.load(open('$P/song.json'));print(s['loop']['bars'],s['fps'],s['loop']['start_sec'])")"
  for mode in save fresh; do
    for which in old new; do
      D=$SCR/$which-$mode-$(basename $P); mkdir -p $D
      python3 -c "import json;s=json.load(open('$P/song.json'));json.dump({'sync':s['sync']} if 'sync' in s else {},open('$D/song.json','w'))"
      A=$([ $which = old ] && echo $SCR/analyze_song.py || echo $NEW)
      EXTRA=$([ $mode = save ] && echo "--start-near $ST")
      python3 $A "$S" --out $D --bars $B --fps $F $EXTRA >/dev/null 2>$D/err || echo "FAIL $which $mode $P: $(cat $D/err)"
    done
    diff <(python3 -m json.tool $SCR/old-$mode-$(basename $P)/song.json) <(python3 -m json.tool $SCR/new-$mode-$(basename $P)/song.json) >/dev/null \
      && echo "same  $mode $P" || echo "DIFF  $mode $P"
  done
done
```

Expected: `same` for every `save` line. A `DIFF` on a `fresh` line is the intended behaviour change (that song's free pick used to run past its end): report it to Jack with both windows. `intro` is hand-built and skipped. If a song file is missing, say so and skip it; never download music.

- [ ] **Step 3: Full suite and leak count**

```bash
count() { ls -d "${TMPDIR:-/tmp}"/{mk-,mv-,np-,tpl-,sz-,tp-,sp-,tag-,skills-}* 2>/dev/null | wc -l; }
before=$(count); npm test; after=$(count); echo "before=$before after=$after"
```

Expected: all green; `after` equals `before`.

- [ ] **Step 4: Commit the docs**

```bash
git add CLAUDE.md docs/superpowers/deferred.md
git commit -m "docs: F1 (MK_KEEP_TMP, is_main, deferred list)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch: merge `hardening-f1` into `main` locally, re-run `npm test` on main, push after Jack's go-ahead. Then remove the old leaked dirs: `rm -rf "${TMPDIR}"mk-*` only after confirming no test run is in progress (`pgrep -fl "node --test"` prints nothing).
