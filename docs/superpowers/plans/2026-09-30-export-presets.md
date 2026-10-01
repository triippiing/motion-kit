# Export Presets (sub-project B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `export.mjs PROJECT --for reels,x,discord,web` turns one motion-kit project into ready-to-post files for each destination (native re-render per shape, per-platform encode, loudness, size caps, web/GIF/poster), with safe-zone checks wired into the planner and `check_brief`.

**Architecture:** A data file (`presets.json`) describes each destination. `render.mjs` gains a stage override (served `project.json` rewritten on the fly, so the project on disk is untouched). `export.mjs` groups presets by shape, renders each shape once, then encodes every destination from its shape's render with ffmpeg (fps drop, scale, CRF or two-pass bitrate under a cap with resolution step-down, two-pass loudnorm) and writes a manifest. `safezones.mjs` measures the shape and cursor per beat in the browser against each preset's margins; `check_brief` calls it when the brief lists exports.

**Tech Stack:** Node 24 (node:test), Playwright 1.63, ffmpeg 9 at /opt/homebrew/bin (libx264, libvpx-vp9, libopus, loudnorm, ebur128, palettegen), existing render/beat_stills/check_brief/harness.

**Spec:** `docs/superpowers/specs/2026-09-30-export-presets-design.md`

## Global Constraints

- Never ship an over-limit file: if a preset's `maxMB` can't be met above the quality floor at the smallest step-down resolution, stop with `error: ...` and write nothing for that preset.
- Presets record `source` (official URL) and `checked` (date) per limit set; unsourced values carry `"estimate": true`, surfaced in the manifest.
- Shapes: `square` 1440x1440, `vertical` 1080x1920, `landscape` 1920x1080; `"shape": "design"` means the project's own stage.
- Renders stay 60 fps with 4 subframes; 30 fps presets drop alternate frames at encode time.
- Loudness: two-pass `loudnorm` to each preset's `lufs`/`truePeak`; verify with `ebur128` (within ±1 LU).
- The project on disk is never modified by exports or shape renders (stage override is served, not written).
- Scripts: `error: ...` + exit 2 on bad input, never a stack trace; CLI entry guard uses realpath (works through the ~/.claude/skills symlink).
- Commercial-track warning on public presets; `--silent` drops audio.
- Wiki copy: no em/en dashes; never push without Jack's go-ahead. Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch `exports`. `npm test` fully green at the end of every task.

## Review Focus

1. **Size cap edge cases:** a very short clip (1 s) under a tiny cap; a long piece where even 540p misses the floor → error with no file. Tested in Task 3.
2. **Shape override leakage:** rendering the vertical shape must not change `project.json` on disk or the default `out/video.mp4`. Tested in Task 2.
3. **Loudness on near-silent audio** (e.g. the synthetic click track or `--silent`): loudnorm must not blow up quiet input into noise; skip normalisation when input LUFS is below -50 and note it. Tested in Task 2.
4. **Safe zones with camera zoom:** the camera scale changes on-screen sizes; the check must use screen-space boxes (getBoundingClientRect), not design px. Tested in Task 4.
5. **Presets that share a render:** reels/tiktok/shorts must trigger one vertical render, not three. Tested in Task 2.

---

## File map

```
skills/motion-video/presets.json                     destinations                        (T1)
skills/motion-video/tests/presets.test.mjs                                               (T1)
skills/motion-video/scripts/render.mjs               --stage WxH override (serve rewrite) (T2)
skills/motion-video/scripts/export.mjs               shape grouping, encodes, manifest   (T2, T3)
skills/motion-video/scripts/media.mjs                ffmpeg/ffprobe helpers (probe, loudness, encode) (T2, T3)
skills/motion-video/tests/export.test.mjs                                                  (T2, T3)
skills/motion-video/scripts/safezones.mjs            per-beat zone check + guides overlay (T4)
skills/motion-video/tests/safezones.test.mjs                                               (T4)
skills/motion-video/scripts/check_brief.mjs          Exports line -> safe-zone warnings   (T4)
skills/motion-design/references/planner.md, SKILL.md; motion-video SKILL.md; CLAUDE.md; README (T5)
demos/04-library-reference/README.md; Wiki claude/motion-kit.html                         (T6)
```

---

### Task 1: presets.json with sourced limits

**Files:** Create `skills/motion-video/presets.json`, `skills/motion-video/tests/presets.test.mjs`.

**Interfaces:** Produces `presets.json` = `{ "shapes": { "square": [1440,1440], "vertical": [1080,1920], "landscape": [1920,1080] }, "presets": { "<name>": Preset } }` where Preset = `{ label, group, shape: "square"|"vertical"|"landscape"|"design", size?: [w,h], fps: 30|60, maxSeconds: number|null, maxMB: number|null, video: { codec: "h264"|"vp9", crf, maxrate?, profile? }, audio: { codec: "aac"|"opus"|null, kbps, lufs, truePeak }, safe: { top, bottom, left, right } (px at `size`), public: boolean, source: string|null, checked: "YYYY-MM-DD", estimate?: true, notes?: string }`. Kinds with extra outputs: `web` has `"outputs": ["mp4","webm","poster"]`; `gif` has `"gif": { width, fps, maxMB }`.

- [ ] **Step 1: Research.** Use web search/fetch to find each platform's current official limits: Instagram Reels, TikTok, YouTube Shorts, X (Twitter) video, LinkedIn video, Discord upload limits (free and Nitro: Jack reports Nitro is 500 MB now and going to 1 GB soon; confirm from Discord's official support page and record the date; if it has already moved to 1 GB, use that). Record per preset: max length, max file size, recommended resolution/fps/codec, and any published safe-zone guidance (if a platform publishes none, derive margins from widely used creator guidance and mark `"estimate": true` with a `notes` line). Loudness: most platforms publish none; use -14 LUFS integrated, -1 dBTP as the social default and mark it `estimate`. Put URLs in `source`, today's date in `checked`.
- [ ] **Step 2: Failing schema test** (`presets.test.mjs`):
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const P = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../presets.json'), 'utf8'));
const NAMES = ['reels','tiktok','shorts','x','x-landscape','linkedin','linkedin-landscape','discord','discord-nitro','web','gif'];
test('every destination exists', () => { for (const n of NAMES) assert.ok(P.presets[n], n); });
test('every preset is complete and consistent', () => {
  for (const [n, p] of Object.entries(P.presets)) {
    assert.ok(['square','vertical','landscape','design'].includes(p.shape), n);
    if (p.shape !== 'design') assert.deepEqual(p.size ?? P.shapes[p.shape], P.shapes[p.shape], `${n} size matches its shape`);
    assert.ok([30, 60].includes(p.fps), n);
    assert.ok(p.maxSeconds === null || p.maxSeconds > 0, n);
    assert.ok(p.maxMB === null || p.maxMB > 0, n);
    assert.ok(p.source || p.estimate === true, `${n} needs a source or estimate:true`);
    assert.match(p.checked, /^\d{4}-\d{2}-\d{2}$/, n);
    const [w, h] = p.size ?? [1440, 1440];
    for (const k of ['top','bottom','left','right']) assert.ok(p.safe[k] >= 0, `${n}.safe.${k}`);
    assert.ok(p.safe.left + p.safe.right < w && p.safe.top + p.safe.bottom < h, `${n} safe zone leaves room`);
    assert.equal(typeof p.public, 'boolean', n);
  }
});
test('discord caps: free 10 MB, nitro larger (500 MB per Jack; 1 GB announced) unless sourced otherwise', () => {
  assert.ok(P.presets.discord.maxMB > 0 && P.presets['discord-nitro'].maxMB > P.presets.discord.maxMB);
});
```
- [ ] **Step 3:** run → FAIL (no file). **Step 4:** write presets.json from the research. **Step 5:** run → PASS; `npm test` green. **Step 6:** commit.

---

### Task 2: Stage override + export core (shape grouping, encode, loudness, manifest)

**Files:** Modify `scripts/render.mjs`. Create `scripts/media.mjs`, `scripts/export.mjs`, `tests/export.test.mjs`.

**Interfaces:**
- `serve(dir, port, { stage })`: when `stage = [w,h]`, a GET of `project.json` returns the file's JSON (or `{}`) with `stage: { width: w, height: h }` merged; nothing written to disk. `render(dir, { stage, out, ... })` and CLI `--stage WxH` pass it through. `openProject(dir, { workers, stage })` likewise.
- `media.mjs`: `probe(file) -> { duration, width, height, fps, vcodec, acodec, bytes }`; `measureLoudness(file) -> { I, TP }` (ebur128); `loudnormArgs(file, { lufs, truePeak }) -> string[]` (two-pass: measure then linear filter; returns [] and `skipped: true` when input I < -50); `encode(input, output, { size, fps, video, audio, silent, bitrate? }) -> void`.
- `export.mjs`: `exportProject(dir, { for: string[], silent, outDir }) -> manifest`; CLI `export.mjs DIR --for a,b,c [--silent]`.

- [ ] **Step 1: Failing tests** (`tests/export.test.mjs`), using `makeProject` from `tests/harness.mjs` with a 2-bar 120 BPM click track (so renders are quick) and a tiny test preset file injected via an env var `MOTION_PRESETS=/path/to/test-presets.json` (export reads it if set) whose presets use small sizes (e.g. vertical 216x384, square 288x288) to keep encodes fast:
```js
test('stage override does not touch project.json or out/video.mp4', async () => { /* render with stage [216,384] to out/shapes/vertical/video.mp4; assert project.json bytes unchanged and default out/video.mp4 absent; probe gives 216x384 */ });
test('presets sharing a shape share one render', async () => { /* export --for reels,tiktok,shorts; count renders via a hook/log (export returns manifest.renders); expect 1 vertical render */ });
test('each export has the preset size, fps, codecs and duration', async () => { /* probe each; fps 30 where preset says 30; duration within 0.05 s of loop */ });
test('loudness lands within 1 LU of target; near-silent input is left alone and noted', async () => { /* clip made louder/quieter vs target; ebur128 I within ±1; a silent clip -> manifest note "loudness skipped" */ });
test('--silent exports have no audio stream', async () => {});
test('manifest lists every file with bytes, duration, size, fps, LUFS, warnings and preset source', async () => {});
test('commercial music on a public preset warns', async () => { /* project.json {"music":"commercial"} -> warning on reels, none on web */ });
test('CLI: unknown preset -> error: ... exit 2; works through a symlinked skill dir', () => {});
```
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** render.mjs `stage` (serve rewrite + `--stage WxH` parse with validation: even ints ≥ 64), `media.mjs` helpers, `export.mjs`:
  - load presets (`MOTION_PRESETS` env or `../presets.json`); resolve `--for` names (unknown → did-you-mean error);
  - group by shape (`design` → project stage); render each shape once (design shape → reuse/produce `out/video.mp4`; others → `out/shapes/<shape>/video.mp4` via `render(dir, { stage })`);
  - per preset: `encode()` with `-vf fps=<fps>,scale=<w>:<h>:flags=lanczos`, `-c:v libx264 -profile:v high -pix_fmt yuv420p -crf <crf> [-maxrate <m> -bufsize <2m>] -movflags +faststart`, audio `-c:a aac -b:a <kbps>k` after loudnorm (two-pass `loudnorm=I=..:TP=..:LRA=11` measured→applied with `linear=true`), or `-an` when silent;
  - write `out/exports/<preset>.mp4` and `manifest.json` (`{ project, created, renders: [{shape, path}], files: [{ preset, path, bytes, duration, width, height, fps, vcodec, acodec, lufs, truePeak, notes: [], warnings: [], source, checked, estimate }] }`); print a one-line summary per file.
- [ ] **Step 4:** tests → PASS; `npm test` green. **Step 5:** commit.

---

### Task 3: Size caps, web outputs, GIF, poster

**Files:** Modify `scripts/export.mjs`, `scripts/media.mjs`, `tests/export.test.mjs`.

**Interfaces:** `fitToCap({ input, duration, maxMB, audioKbps, sizes: [[w,h],...], floorKbps: {1080:1500,720:800,540:450} }) -> { size, videoKbps } | { error }`; `encodeTwoPass(...)`; web → `<preset>.mp4`, `<preset>.webm`, `<preset>.jpg`; gif → `<preset>.gif`.

- [ ] **Step 1: Failing tests:**
```js
test('over a cap, two-pass bitrate lands just under maxMB', async () => { /* preset maxMB small but reachable at full size: bytes <= cap and >= 0.8*cap */ });
test('when full size cannot meet the floor, resolution steps down and the manifest says so', async () => {});
test('when even the smallest size cannot meet the floor, the export stops with a clear error and writes no file', async () => {});
test('web writes mp4 (faststart), webm (vp9/opus) and a poster jpg from a settled frame', async () => {});
test('gif stays under its cap, stepping width down if needed', async () => {});
test('over maxSeconds warns (not an error)', async () => {});
```
- [ ] **Step 2:** FAIL. **Step 3: Implement:** target total kbps = `maxMB*8*1024*0.97 / duration`; video kbps = total − audio kbps; pick the largest size whose floor ≤ video kbps (sizes derived from the preset size scaled to 1080/720/540 short side, even dims); two-pass x264 (`-pass 1 -f null`, `-pass 2`, passlogfile in a temp dir); verify bytes ≤ cap (retry once at 0.93 if over); error otherwise. Web: mp4 as a CRF encode; webm `-c:v libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 -c:a libopus -b:a 96k`; poster `-ss <beat 1 + 0.5 beat> -frames:v 1 -q:v 3`. GIF: `fps=<fps>,scale=<width>:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, step width down (×0.8) until ≤ cap (max 4 tries, else error).
- [ ] **Step 4:** PASS; `npm test` green. **Step 5:** commit.

---

### Task 4: Safe zones (check + guides) and check_brief integration

**Files:** Create `scripts/safezones.mjs`, `tests/safezones.test.mjs`. Modify `scripts/check_brief.mjs`, `tests/check_brief.test.mjs`, `scripts/export.mjs` (`--guides`).

**Interfaces:** `checkSafeZones(dir, { presets: string[], samples: 'beats'|'half' }) -> { issues: [{ preset, beat, t, part: 'shape'|'cursor', edge: 'top'|'bottom'|'left'|'right', px }] }` (renders each needed shape via `openProject(dir, { stage })`, seeks each beat and half-beat, reads `#shape` getBoundingClientRect and `window.inspect(t).cursor` in screen px, compares to margins scaled to the stage); `guides` render: `render(dir, { stage, guides: presetName, preview: true })` injects translucent zone bands after ready (never used by export encodes). CLI `safezones.mjs DIR --for reels,tiktok`. check_brief: parse `**Exports:**` from Decisions (comma list of preset names; unknown → error), run `checkSafeZones` for them (strict), and add each issue as a warning: `beat 12: shape extends 40 px into the Reels bottom zone`.

- [ ] **Step 1: Failing tests:** a vertical fixture project with a wide component placed so it enters the bottom zone at one beat → one issue at that beat/edge; a centred small component → none; zoom accounted (compare with camera scale > 1); check_brief with an Exports line surfaces the warning and without it runs no browser; guides preview renders bands (pixel check that a band region differs from the unguided frame) and exports never include guides.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS; `npm test` green. **Step 5:** commit.

---

### Task 5: Planner and docs

**Files:** Modify `skills/motion-design/references/planner.md`, `skills/motion-design/SKILL.md`, `skills/motion-video/SKILL.md`, `CLAUDE.md`, `README.md` (+ CREDITS.md only if new sources are used beyond platform docs).

- [ ] planner.md question 2 → "Where will you post it?" multiple choice over the destination groups (more than one allowed); the first choice sets the design shape (vertical for Reels/TikTok/Shorts, square otherwise unless landscape chosen); Decisions gains `**Exports:** reels, x, discord, web`; Assessments add "safe zones: check_brief checks them for the chosen exports"; Gate hand-off ends with `export.mjs`.
- [ ] motion-video SKILL.md: new "Export" section (command, presets list, manifest, `--silent`, `--guides`, size-cap behaviour, commercial-music warning); build loop's final step becomes export.
- [ ] CLAUDE.md: "How a video gets made" gains the export step; code map adds presets.json, export.mjs, media.mjs, safezones.mjs.
- [ ] README: short "Exporting" section with the one command.
- [ ] A check_brief test that the state-plan worked example and recipes still pass (no Exports line → no browser).
- [ ] (Controller) baseline/GREEN planner runs for "a 15 s promo for Reels and X".
- [ ] `npm test` green; commit.

---

### Task 6: Proof on demo 04 + wiki

- [ ] Add `**Exports:** reels, x, discord, web, gif` to demo 04's brief; run check_brief (safe zones for vertical); if content enters a zone, report it to Jack before changing anything (brief changes need approval).
- [ ] `export.mjs demos/04-library-reference --for reels,x,discord,web,gif`; ffprobe every file, Read a still from each, confirm limits and loudness; commit the manifest (not the media) and a results table in demo 04's README.
- [ ] Wiki: a short "Exporting" step on the motion-kit page with the command, the destinations and demo 04's results table (no dashes; local commit only; the controller asks before pushing).

### Task 7: Wrap-up

- [ ] `npm test` green, doctor ok, memory updated (B done, next C), report to Jack with the merge/push question.
