# Export presets (sub-project B) — design

Date: 2026-09-30
Status: draft, awaiting review
Part of: the motion-kit roadmap (A done; B this; then C sync tools, D narrative, E real-app footage, F hardening)

## Purpose

Today `render.mjs` makes one high-quality MP4 (60 fps, H.264 CRF 16, AAC 256k) plus a half-size
preview. Posting it anywhere means hand-tuning ffmpeg. B turns "where will this be posted?" into
ready-to-post files for every chosen destination, from one project, with the planner asking the
question and checking the brief against each platform's safe zones.

Success means:
1. `node export.mjs PROJECT --for reels,x,discord,web` produces correct files for every destination
   in `out/exports/`, plus `manifest.json`, with no hand-tuning.
2. Each file is within its platform's limits (size, length, resolution, frame rate) and loudness
   target, or the export stops with a clear message; it never silently ships an over-limit file.
3. Different shapes (square, vertical, landscape) are rendered natively from the same project, not
   letterboxed.
4. The planner asks where the piece will be posted (multiple choice), records the exports in the
   brief, and `check_brief` warns when content enters a chosen platform's safe zones.
5. Demo 04 is exported to all four destination groups and each output is verified.

## Non-goals

- Captions/subtitles (decided: skip; on-screen text belongs in the piece; D adds title cards).
- Uploading or posting anywhere (outputs are files only).
- Re-timing to a different length per platform (length is the piece's; over-limit is a warning).
- Letterboxing (decided: re-render per shape).

## Destinations (v1)

| Group | Presets | Shape |
|---|---|---|
| Reels / TikTok / Shorts | `reels`, `tiktok`, `shorts` | vertical 1080x1920 |
| X / LinkedIn | `x`, `linkedin` | square 1440 by default; `x-landscape`, `linkedin-landscape` for 1920x1080 |
| Discord / chat | `discord` (10 MB cap), `discord-nitro` (500 MB per Jack, 2026-09-30; rising to 1 GB soon: confirm against Discord's official page at build time) | the design shape |
| Web / wiki / GitHub | `web` (small MP4 + WebM + poster JPG), `gif` (README-friendly GIF) | the design shape |

Exact limits (max length, max file size, bitrate ceilings, recommended loudness, safe-zone margins)
are researched from each platform's current official documentation at build time and recorded in the
preset with a `source` URL and `checked` date. Values that cannot be sourced officially are marked
`"estimate": true` and the manifest says so.

## The presets file

`skills/motion-video/presets.json`, one entry per destination:

```json
"reels": {
  "label": "Instagram Reels", "shape": "vertical", "size": [1080, 1920], "fps": 30,
  "maxSeconds": 90, "maxMB": null,
  "video": { "codec": "h264", "crf": 20, "maxrate": "8M", "profile": "high" },
  "audio": { "codec": "aac", "kbps": 192, "lufs": -14, "truePeak": -1 },
  "safe": { "top": 220, "bottom": 420, "left": 60, "right": 140 },
  "source": "https://...", "checked": "2026-10-01"
}
```
Shapes: `square` 1440x1440, `vertical` 1080x1920, `landscape` 1920x1080. `web`/`gif`/`discord` use
the project's own shape (`"shape": "design"`).

## Export pipeline (`scripts/export.mjs`)

```
export.mjs PROJECT --for reels,x,discord,web [--silent] [--guides] [--only-shape vertical]
```
1. Resolve presets; group by shape; the project's own shape (project.json stage) renders into the
   existing `out/video.mp4` path, other shapes into `out/shapes/<shape>/video.mp4` by rendering the
   same project with a stage override (no copy of the project). Renders stay 60 fps, 4 subframes.
2. Per destination, encode from its shape's render:
   - frame rate: 60 → 30 by dropping alternate frames (no re-render);
   - scale to the preset size if different;
   - video: CRF at the preset quality; if over `maxMB`, switch to a two-pass bitrate targeted at the
     cap (from length and audio share); if the implied bitrate falls below a quality floor, step the
     resolution down (1080 → 720 → 540) and note it; if that still fails, stop with an error;
   - audio: two-pass `loudnorm` to the preset's LUFS and true peak; `--silent` drops audio;
   - web: MP4 (faststart) + WebM (VP9/Opus) + poster JPG (from a settled frame, default beat 1);
     gif: palette-generated GIF at reduced size/fps within a cap.
3. Write `out/exports/<preset>.<ext>` and `out/exports/manifest.json` (per file: path, preset,
   size bytes, duration, resolution, fps, codecs, measured LUFS and true peak, warnings, any
   resolution step-down, source/checked of the preset).
4. Warnings (in the manifest and printed): over `maxSeconds`; commercial-track risk on public
   platforms (from the brief's Decisions, or a `"music": "commercial"` flag in project.json) with a
   hint to use `--silent` or a licensed track; any `estimate: true` preset value used.

`render.mjs` gains a `--stage WxH` (or `--shape`) override used by export; nothing else changes for
existing users.

## Safe zones

- `scripts/safezones.mjs PROJECT --shape vertical --presets reels,tiktok`: seeks each beat (and
  mid-beats), reads the shape's box and the cursor position from the page (camera zoom included), and
  reports each beat where either enters a preset's margins: "beat 12: slider extends 40 px into the
  Reels bottom zone". Exposed as a function for check_brief.
- `--guides` on export (or `render.mjs --guides`) renders a preview with translucent bands over each
  preset's zones for visual checking; guides never appear in exports.

## Planner integration

- `planner.md` question 2 becomes "Where will you post it?" (multiple choice over the destination
  groups, more than one allowed). The first choice sets the design shape; others are re-rendered.
- `MOTION-BRIEF.md` Decisions gains an `Exports:` line listing presets.
- `check_brief.mjs` runs the safe-zone check for every chosen vertical/landscape/square preset
  whose shape it can render, as warnings (to be resolved or justified), when the brief lists exports.
- motion-video SKILL.md: final step becomes `export.mjs` for the brief's destinations.

## Testing

- presets.json schema test (every preset complete; shape valid; source/checked present or
  `estimate: true`; safe margins inside the frame).
- Shape grouping: one render per shape across many presets.
- Real encodes of a small fixture project: each preset's output has the right size, fps, codecs and
  duration; loudness within ±1 LU of target; `--silent` has no audio stream.
- Size cap: force `maxMB` below what's achievable at full size → resolution step-down noted in the
  manifest; force it below any achievable size → export stops with a clear error, no file written.
- Safe zones: a fixture component placed inside a zone is flagged at the right beat and edge; one
  outside is clean; zoom is accounted for.
- Planner: baseline/GREEN behaviour check for the destinations question and the Exports line.
- CLI through the installed symlink path (as all scripts).

## Proof

Export demo 04 to `reels,x,discord,web,gif`: inspect every file (ffprobe + a still), confirm limits
and loudness, check the vertical version's safe zones (fixing the brief only if content really
enters a zone, with Jack's approval), and add a small results table to demo 04's README and the wiki.

## Build order (for the plan)

1. presets.json (with sourced limits) + schema test.
2. render.mjs stage override + export.mjs core (shape grouping, encodes, loudness, manifest).
3. Size-cap logic (two-pass, step-down, errors) + web/gif outputs.
4. Safe zones (check + guides) + check_brief integration.
5. Planner and docs (planner.md, SKILL.md, CLAUDE.md, README, CREDITS if new sources).
6. Proof on demo 04 + wiki section.
