---
name: motion-story
description: Use when the user wants a motion video made from something that already exists — "make a clip of this repo", a repo intro, a release ("what's new in v2"), or a pull request — rather than from a blank brief. Reads the source into a facts file (story_facts.mjs), drafts STORY.md from it for approval, then hands over to motion-design's planner. Scripts: story_facts.
---

# Motion story

Turns an existing source (for now a code repository: its intro, a release or a pull request) into a motion-kit video: `scripts/story_facts.mjs` reads the source into a facts file (`scripts/facts.mjs` defines the format), Claude drafts `STORY.md` from those facts, the user approves it, and motion-design plans and builds the piece as usual. The full flow is written in a later step.
