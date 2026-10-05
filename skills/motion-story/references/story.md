# Drafting STORY.md

STORY.md is the story of one video, drafted by Claude from a facts file (`story_facts.mjs`) and approved by the user
before anything is planned. It lives in the project directory, next to `facts.json`. Once approved it is the request
motion-design plans from. `V=~/.claude/skills/motion-video`.

## The format

```markdown
# Story: motion-kit 1.4
**Source:** story_facts.mjs repo https://github.com/triippiing/motion-kit --release latest -> facts.json
**Story:** release

## Hook
"motion-kit 1.4" (button) ...

## Moments
1. Sequences: chapters on one song (card; text from items[0])
2. ...

## End card
github.com/triippiing/motion-kit (button)
```

- `# Story: NAME`: the facts' `title` (a release's is the repo name and the tag, `motion-kit v1.4`; a pull request's
  is its title).
- `**Source:**` the facts' `source.command` exactly as written in the file, then ` -> ` and the facts file's name.
  It is how the facts are re-created later, so never retype or tidy it.
- `**Story:**` the facts' `source.story`: `intro`, `release` or `pr`.
- `## Hook`: the opening beat: the on-screen words in quotes, the component in brackets, and in a few words what
  happens (the cursor presses it, it morphs into the first moment).
- `## Moments`: numbered, one per line: the on-screen words, then in brackets the component and where the words
  came from (`text from items[0]`, `subtitle`, `stats.commits`, `links.install`). One moment per line, in the order
  they play.
- `## End card`: what stays on screen at the end, usually `links.url` written short (`github.com/OWNER/REPO`) or
  `links.install`, with its component.
- Optional, after the End card: `## Left out` (facts that did not fit, one line each) and `## Media` (what the facts
  list and whether it is used; see Media below).

## How many moments

- A single loop is a hook, 3 to 5 moments and an end card.
- More facts than fit: pick the most significant (items are already ordered most significant first: features,
  fixes, docs, other, changes) and list the rest under `## Left out`, so the user can swap one in.
- More than fits one loop (the user wants every item, or a long launch video): propose chapters, a sequence on one
  song (intro, one chapter per group of moments, end card; the Long pieces section of motion-design's planner),
  with one STORY.md for the whole piece and its moments grouped under `### Chapter NAME` headings in `## Moments`.

## Thin facts

A README without a features section gives `items: []` (motion-kit's own does). Then build the story from what is
there: the `subtitle` (one moment on a card, or split at its sentences), `stats` (a commit count on a counter;
stars and forks from a URL), `links.install` (the install line typed into a command or input), `links.url` (the end
card) and `media` (only as below). Three moments from those is a complete story. If there is too little for three,
say so and ask the user for the missing moments; never invent features, facts or numbers to fill the gap.

## Words and components

- Each moment names a catalog component from `$V/components/CATALOG.md`, picked by its "Use when" line (a card for a
  headline and a line of context, a counter for a number, a button for a call to action, a command or input for a
  line typed in, a list for a few short items, a toast for a short confirmation, a check for done).
- Its on-screen words fill that component's props and stay within what it can show: about as long as the entry's
  defaults and example (a button label is two to four words, a card title a few words and its body one short line).
  check_brief's frame check is the final word: it warns on text running past or cut off in its shape.
- Words come from the facts: shorten them where needed (cut words, keep the meaning), never add a claim, a feature
  or a number that is not in the facts. Numbers are written as the facts give them (a counter's value is the
  number itself, not a rounded one).
- A label and its detail can split across a component's props (a card's title and body, a toast's text and
  action).

## Media

Facts `media` (screenshots, GIFs) can become real-app footage (the `footage` component), only with the user's
say-so: a GIF or video with `node $V/scripts/footage.mjs FILE --out DIR/footage/NAME`, a live page with
`node $V/scripts/capture.mjs APP.html --steps steps.json --out DIR/footage/NAME` (the Footage step of motion-design's
planner). Without a yes, list the media under `## Media` as not used.

## Approval and hand-over

Show STORY.md and stop for the user's approval or edits. Then hand it to motion-design as the request: the planner
skips the questions STORY.md answers (the goal, the moments and their components and words) and keeps its words;
it asks the rest as usual (where it will be posted, length, the song: a file the user has the rights to, never
downloaded; the product's look), then the song measurement, the brief, check_brief and the approval gate. Nothing is
posted anywhere: the result is files the user posts.
