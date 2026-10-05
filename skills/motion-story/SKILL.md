---
name: motion-story
description: Use when the user wants a motion video made from something that already exists — "make a video of this repo", "a clip of this repo", a repo intro, a release ("what's new in v2", "the latest release"), or a pull request — rather than from a blank brief. Reads the source into a facts file (story_facts.mjs), drafts STORY.md from it for approval, then hands over to motion-design's planner. Scripts: story_facts.
---

# Motion story

Turns something that already exists into a motion-kit video. For now the source is a code repository: its intro,
a release or a pull request. Later sources (a post, a set of numbers) will plug into the same flow; they are not
built yet, so for "this post" or "these numbers" say so and plan from a blank brief with motion-design.

The split: `scripts/story_facts.mjs` reads the source into a facts file (deterministic: the same input gives a
byte-identical file); Claude drafts `STORY.md` from those facts; the user approves it; motion-design plans and
builds the piece as usual. `S=~/.claude/skills/motion-story/scripts`.

**Read `references/story.md` and follow it exactly.** Make each step below a todo.

## The flow

1. **Route.** Say it: "a video from your repo: I'll read it into facts, draft a STORY.md for you to approve, then
   plan it with motion-design." Animation inside an app goes to motion-ui; a blank-page promo to motion-design.
2. **Pick the story kind.** intro (the default: what the project is), release (what changed in a tag), pr (what a
   pull request or branch does). Ask only if the request is unclear, as one multiple-choice question.
3. **Pick the project directory** (DIR) and run the reader into it:

   ```bash
   node $S/story_facts.mjs repo SOURCE [--intro | --release TAG|latest | --pr N|BRANCH] --out DIR/facts.json
   ```

   The usage line is `story_facts.mjs <kind> SOURCE [--intro | --release TAG|latest | --pr N|BRANCH] --out FILE`;
   `repo` is the only kind. Pass at most one of the three flags; with none the story is intro. It prints
   `FILE: N items (repo, STORY)`. Bad input exits 2, a failure while reading exits 1; both print `error: ...`.
   - SOURCE is a local git work tree (any path inside it) or a GitHub URL `https://github.com/OWNER/REPO`
     (optional `www.`, `.git`, trailing slash). Prefer a local clone when there is one. A remote written
     without a scheme (`git@github.com:o/r`, `github.com/o/r`) is refused: give the URL or a clone.
   - `--release TAG` reads the commits from the previous version tag to TAG (for a tag that is not a version,
     from the tag created before it; over a URL, the one the API lists after it, since GitHub does not promise
     creation order). Over a URL a GitHub release for TAG with bullets takes precedence: its bullets are the
     items. `--release latest` picks the highest version tag that is not a pre-release (a pre-release only when
     every version tag is one; with no version tags, the newest tag). A repo with no tags: `no tags: tag a
     release first, or use --intro`.
   - `--pr N` (a number, `#N` too) needs a GitHub URL: on a local clone it is `--pr N: pull request numbers need
     a GitHub URL; on a local clone pass a branch (--pr BRANCH)`. `--pr BRANCH` needs a local clone: on a URL it
     is `--pr BRANCH: a GitHub URL takes a pull request number (--pr N); for a branch use a local clone`. A
     branch is compared with origin/HEAD, else main, else master; its title is the oldest commit's subject
     (conventional prefix stripped). A missing PR is `no pull request #N in OWNER/REPO`.
   - A GitHub URL is read with read-only GETs to the GitHub API; nothing else is ever sent. Public repos only:
     a private one (or a typo), with no token that can read it, is `not found (private repos: use a local
     clone)`. Without a token GitHub allows 60 requests an hour; on `rate limited by GitHub: set GITHUB_TOKEN or
     try later`, the user can set `GITHUB_TOKEN` (sent only when it is set). A release over a URL lists at most
     250 commits, and tags or commits at most 10 pages (a warning says so; a local clone reads them all).
4. **Read the facts** (Read `DIR/facts.json`; the format is the header of `scripts/facts.mjs`). `title`,
   `subtitle`, `items` (at most 12: an intro's in README order; a release's or pr's ranked, features, fixes,
   docs, other, then changes), `stats`, `links`, `media`. Text is already cut to the caps (title 80, subtitle
   200 as whole sentences when they fit, item label 60, detail 160, media alt 160 characters, cut with "…").
   Badges, navigation bullets (a table of contents, docs links) and commit trailers (`Signed-off-by:`,
   `Co-Authored-By:`) are left out. `source.command` is the command that re-creates the file (without `--out`;
   `--intro`, the default, is never written). Say what was found in one or two lines, and what is thin (no
   items, no stats).
5. **Draft `DIR/STORY.md`** from the facts, exactly as `references/story.md` says.
6. **Approval.** Show STORY.md and stop. The user approves it or edits it (edit the file for them); nothing is
   planned before a yes.
7. **Hand over to motion-design** with the approved STORY.md as the request: its planner skips the questions
   STORY.md answers and asks the rest (where it will be posted, the product's look, the song) as usual, settles
   the length in bars once the song is measured, writes MOTION-BRIEF.md, runs check_brief and stops at its own
   approval gate.

## Red flags

| Thought | Reality |
|---|---|
| "The README is thin, I'll add a few features it obviously has" | Never invent features, facts or numbers. Use only what the facts file holds (or the user tells you); shorten wording, never add claims. |
| "The facts say 272 commits, '~300 commits' reads better" | Numbers are shown as they are in the facts. |
| "STORY.md is obvious, I'll go straight to the brief" | STORY.md is approved before any planning. |
| "It's private, I'll try the URL with a token" | Private repos are read from a local clone, never over the API. |
| "I'll post the video / open a release / comment on the PR" | Never post anywhere. motion-kit renders files; the user posts them. |
| "The repo's README links a song, I'll grab it" | Never download music. The song is a file the user has the rights to (motion-design asks). |
| "There's a GIF in the facts, I'll turn it into footage" | Media becomes footage only with the user's say-so (`footage.mjs`, `capture.mjs`). |
| "Twelve items, twelve moments" | One loop holds 3 to 5 moments: pick the most significant and say which were left out; more is a sequence (chapters). |
