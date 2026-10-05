# Sequences (D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chapters (ordinary projects) played back to back on one song: one `sequence.json`, one script to line the windows up, check, render with one continuous song cut, and export through the presets.

**Architecture:** `scripts/sequence.mjs` reads and validates `sequence.json` (SEQ dir), drives `analyze_song.py` per chapter with abutting windows and a shared sync, checks continuity plus each chapter's brief, renders each chapter with render.mjs and joins video while laying ONE cut of the song (plus each chapter's UI sounds at its offset) underneath. `export.mjs` learns to take a SEQ dir by building per-shape joined renders the same way.

**Tech Stack:** Node 22 (node:test), Python analyser, ffmpeg, Playwright Chromium (existing).

**Spec:** `docs/superpowers/specs/2026-10-04-sequences-design.md`

Paths relative to `~/motion-kit`; `MV=skills/motion-video`. Branch `sequence` (already created; spec committed).

## Global Constraints

- Not merged or pushed before Jack's morning review (overnight authorization); work only on branch `sequence`.
- One song per sequence; chapters back to back; no other transitions.
- Scripts fail with `error: ...` and exit 2 on bad input, never a traceback; runtime failures exit 1.
- Existing single-project behaviour (render, export, check_brief, analyze) unchanged — every existing test passes.
- Never download, copy or commit music; tests use synthetic click tracks; the acceptance run reads Jack's Tease Me file in place and writes only to scratch (never into `~/motion-kit-launch`).
- No new dependencies. Match surrounding idiom. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- bash, `export PATH=/opt/homebrew/bin:$PATH`; full suite `npm test`.

## Review Focus

1. A chapter whose window was re-analysed by hand (gap or overlap at a join) must fail `check` naming the chapter and the gap — Task 2.
2. Chapters at different stage sizes or fps must fail `render` before rendering anything, with a clear error — Task 3.
3. The joined audio must have no seam at a join (no fade dip, no duplicate or missing samples) — Task 3 asserts sample continuity against the song cut.
4. A stale chapter is re-rendered and a fresh one reused (stamps), so editing one chapter doesn't re-render all — Task 3.
5. Chapter 1's ear-set sync (nudge, tempo map, swing) reaches every chapter on `analyse`, and a later chapter's own sync is overwritten with a warning, never silently — Task 2.

---

### Task 1: `sequence.json`, validation and `init`

**Files:** Create `$MV/scripts/sequence.mjs`, `$MV/tests/sequence.test.mjs`.

**Interfaces (Produces):** `loadSequence(seqDir) -> { root, song, chapters: [{ name, dir, bars, from_start?, start_bar? }], fade_out_sec }` (throws `UsageError` from render.mjs with exact messages); `initSequence(seqDir, { song, names, bars = 4 }) -> seq`; CLI `node sequence.mjs SEQ <init|analyse|check|render|watch> [...]`, usage line printed on bad usage (exit 2), dispatch table so later tasks add commands.

- [ ] **Step 1: Failing tests** — valid file loads (dirs resolved against SEQ); errors (exit 2 via CLI, `UsageError` via API) for: missing sequence.json, invalid JSON, unknown top-level or chapter key, missing chapter dir, `bars` < 1 or non-integer, both `from_start` and `start_bar` on chapter 1, `from_start`/`start_bar` on a later chapter, no chapters, missing song file; `init --song PATH a b c --bars 3` creates sequence.json and three projects (new_project.sh) with `"loop": false` in each project.json; init refuses an existing sequence.json.
- [ ] **Step 2: Run** `node --test $MV/tests/sequence.test.mjs` → FAIL.
- [ ] **Step 3: Implement** (header comment documents the file format and commands; `isMain` guard; errors as `error: <message>`).
- [ ] **Step 4: Run** → PASS; full `npm test`.
- [ ] **Step 5: Commit** — `sequence: sequence.json, validation and init` + trailer.

### Task 2: `analyse` and `check`

**Files:** Modify `$MV/scripts/sequence.mjs`; Test `$MV/tests/sequence.test.mjs`.

**Interfaces:** `analyseSequence(seq, { python }) -> [{ name, start_bar, start_sec, duration_sec }]`; `checkSequence(seq) -> { errors: string[], warnings: string[] }`.

- [ ] **Step 1: Failing tests** (3 chapters of 2, 3, 2 bars on a 40 s click track, chapter 1 `from_start`):
  - analyse: chapter k+1's `loop.start_sec` == chapter k's `start_sec + duration_sec` within 1 ms; `loop.start_bar` abuts; prints one line per chapter (`name: bars A-B, m:ss.s-m:ss.s`).
  - chapter 1's `sync` (nudge_ms -10, swing 0.6) is copied to chapters 2-3 before analysing; a chapter 2 with its own different sync gets a `warning: kit's sync was replaced by intro's` line (Review Focus 5).
  - check: passes on the analysed sequence; after re-analysing chapter 2 by hand with a different `--start-bar`, fails with `kit starts 0.500 s after intro ends` (or "before") naming the chapter (Review Focus 1); runs check_brief (`--no-loop`) on a chapter that has a MOTION-BRIEF.md and reports its errors prefixed with the chapter name; mismatched bpm/sync/fps between chapters is an error.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — run the analyser as sync.mjs / swap_song.mjs do (PATH with /opt/homebrew/bin; analyser `error:` line surfaced; exit 2 on usage-type failures). Chapter 1: `--from-start` or `--start-bar`; later: `--start-bar prev.start_bar + prev.bars`. Pass the project's fps.
- [ ] **Step 4: Run** → PASS; full `npm test`.
- [ ] **Step 5: Commit** — `sequence: analyse lines chapters up on one song; check continuity and briefs` + trailer.

### Task 3: `render` and the joined output

**Files:** Modify `$MV/scripts/sequence.mjs` (and render.mjs only to export an existing helper if needed, behaviour unchanged); Test `$MV/tests/sequence.test.mjs`.

**Interfaces:** `renderSequence(seq, { preview = false, stage } = {}) -> outFile` (default SEQ/out/sequence.mp4; with `stage` [W,H] → SEQ/out/shapes/<W>x<H>/sequence.mp4); writes a `.render.json` stamp listing each chapter's stamp.

- Video: each chapter's render (render.mjs; reuse when its stamp is fresh, re-render when stale — Review Focus 4), concatenated losslessly where possible (same codec settings) or re-encoded once at the end; all chapters must share stage size and fps or it fails before rendering (Review Focus 2).
- Audio: ONE cut of the song from chapter 1's `loop.start_sec` for the summed duration (write it with the same ffmpeg approach as analyze_song's `write_clip`: in/out 10 ms fades only at the very ends), the sequence's `fade_out_sec` at the end, mixed with each chapter's UI sounds (window.SFX / the sounds render.mjs mixes) offset by the chapter's start. Read render.mjs to reuse its SFX mixing rather than duplicate it; if it can't take an offset, add a parameter without changing its existing behaviour.

- [ ] **Step 1: Failing tests** — 3-chapter synthetic sequence (preview): sequence.mp4 video frame count == sum of chapter frame counts; audio duration == summed loop durations ±1 frame; at each join, the decoded audio around the join matches the song cut (correlation ≥ 0.99 over ±50 ms) — no dip (Review Focus 3); the last `fade_out_sec` ramps to silence; a chapter at another `--size` → `error:` before any render; editing chapter 2's index.html then `render` re-renders only chapter 2 (spy on the stamps / mtimes).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; full `npm test`.
- [ ] **Step 5: Commit** — `sequence: render chapters and join them over one continuous cut of the song` + trailer.

### Task 4: Export a sequence

**Files:** Modify `$MV/scripts/export.mjs`; Test `$MV/tests/export.test.mjs` (new tests) or `sequence.test.mjs`.

- `export.mjs SEQ --for ...` detects sequence.json: per preset shape it calls `renderSequence(seq, { stage })` and feeds that file to the existing encode path (size caps, loudness, GIF, poster, manifest; manifest gains `"sequence": { "chapters": [names] }`). Safe-zone checks run per chapter at that shape (the existing per-project check) and their issues are prefixed with the chapter name. `--silent` and `--guides` behave as for a project. Single-project export unchanged.

- [ ] **Step 1: Failing tests** — `export.mjs SEQ --for web,gif` on the synthetic sequence writes the files and a manifest with the chapters; duration matches sequence.mp4; an unknown preset is still exit 2; a project dir still exports exactly as before (existing tests).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; full `npm test`.
- [ ] **Step 5: Commit** — `export: a sequence exports through the presets` + trailer.

### Task 5: `watch` shorthand, docs, launch rebuild check

**Files:** Modify `$MV/scripts/sequence.mjs` (watch), `CLAUDE.md`, `$MV/SKILL.md`, `skills/motion-design/references/planner.md`.

- [ ] **Step 1:** `sequence.mjs SEQ watch CHAPTER` runs watch.mjs on that chapter (spawn, stdio inherited, signals forwarded as swap_song does with sync.mjs); test: unknown chapter → exit 2.
- [ ] **Step 2: Docs** per the spec's Docs section.
- [ ] **Step 3: Launch rebuild (report only):** copy `~/motion-kit-launch` to a scratch dir (never write into the original), write a sequence.json for intro/kit/finance/end with the chapters' bars (read each chapter's song.json `loop.bars`; intro from_start if its loop is `from_start`, else its `start_bar`) and the Tease Me song (`~/Downloads/2000s-x-90s-RB-Pop-Pharrell-Type-Beat---Tease-Me.mp3`, read in place), run `check` and `render --preview`, and record: check result, sequence.mp4 duration vs the shipped linkedin.mp4 (60.7 s), and the export gap check on its audio. Differences are reported, not fixed in the launch files.
- [ ] **Step 4:** full `npm test`.
- [ ] **Step 5: Commit** — `sequence: watch a chapter; docs` + trailer.
