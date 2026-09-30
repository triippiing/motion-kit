# Component library (sub-project A) — design

Date: 2026-09-30
Status: draft, awaiting review
Part of: the motion-kit improvement roadmap (see "Roadmap" at the end)

## Purpose

Building a promo today means hand-writing every state's shape, content and motion in
`index.html` (demo 1 and 2 each took 10+ minutes of expert work and hundreds of lines). This
sub-project adds a library of ready-made, `seek(t)`-pure UI components that a promo names in its
`states()` table, so a new piece is mostly a filled-in plan table.

Success means:
1. A promo can be written with `{ use: '<component>', ...props }` rows and `target:`-based cursor
   rows, with no hand-written geometry or content code for library components.
2. `motion-design` proposes fitting components for each beat from a product description, using
   each component's "use when" text; the user approves or swaps.
3. Claude (and people) can learn the library from generated docs with pictures, recipes and a
   one-page authoring guide, and get friendly errors for mistakes.
4. `demos/04-library-reference` rebuilds demo 1's sequence using only the library, with a large
   reduction in hand-written code versus `demos/01-reference/index.html`.

## Non-goals

- Real-app footage, export presets, sync tools, narrative cards, hardening: later sub-projects.
- Changing existing demos 01–03 or breaking projects made with the current template.
- Multiple visual styles. One house style, themed through the existing roles
  (`canvas surface ink muted accent`, optional `pos neg`) and the project's font.
- Copying anything from transitions.dev. Components are our own implementations; where one
  mirrors a common UI pattern its name may match the catalog's for discoverability.

## The component set (v1: 28 components + 2 row modifiers)

| Group | Component | Use when | Key props | Hotspots |
|---|---|---|---|---|
| Controls | `button` | A call to action is pressed | `label`, `icon` | `button` |
| | `toggle` | A setting switches on/off | `on`, `label` | `knob` |
| | `checkbox` | An item is ticked | `checked`, `label` | `box` |
| | `slider` | A value is dragged (volume, amount) | `value`, `min`, `max`, `overstretch` | `thumb`, `track` |
| | `tabs` | Switching between views (segmented control) | `items`, `active` | `tab:<item>` |
| | `input` | Text is typed into a field | `placeholder`, `type` (text + per-beat timing), `icon` | `field`, `clear` |
| | `dropdown` | A menu opens and an option is chosen | `label`, `items`, `open`, `selected` | `trigger`, `item:<item>` |
| Feedback | `loader` | Something is working | `style` (`spinner`, `dots`) | — |
| | `check` | Success confirmed | `label` | — |
| | `toast` | An action finished (saved, sent, exported) | `text`, `icon` | `toast`, `action` |
| | `progress` | Something fills toward a goal | `value`, `label` | `bar` |
| | `status` | A live state reads out (connected, syncing) | `level` (`ok`,`warn`,`error`), `text`, `collapsed` | `pill` |
| Data | `card` | A titled panel of information | `title`, `body`, `figure` | `card` |
| | `counter` | A number rolls to a value (savings, users) | `from`, `to`, `prefix`, `suffix`, `decimals` | `figure` |
| | `line-chart` | A trend over time, with a hover readout | `points`, `hover` (index), `label` | `point:<i>` |
| | `bar-chart` | Comparing a few values | `bars` ({label, value}) | `bar:<label>` |
| | `list` | Rows of items (transactions, files, results) | `rows`, `highlight` | `row:<i>` |
| | `calendar` | A week strip with marked days | `week` (ISO date of Monday), `marks` ({day, label}) | `day:<n>` |
| | `sparkline` | A compact trend with the latest point | `points`, `label`, `value` | `last` |
| | `goal` | Progress toward a target amount | `name`, `saved`, `target`, `met` | `bar` |
| App chrome | `player` | Media playback with play/pause and scrubbing | `title`, `artist`, `playing`, `position` | `play`, `thumb` |
| | `island` | A compact live status pill (now playing, timer) | `text`, `icon` | `island` |
| | `command` | A command palette: type to filter, enter | `query` (typed), `items`, `selected` | `row:<i>` |
| | `dock` | App navigation with a travelling selection | `items`, `active` | `item:<item>` |
| | `sheet` | A modal or bottom sheet opens with content | `title`, `body`, `actions` | `action:<label>` |
| | `banner` | A notification arrives | `title`, `body`, `icon` | `banner` |
| | `avatar-stack` | People / collaborators on something | `people` (initials), `extra` | `avatar:<i>` |
| | `chip-row` | Filters or tags being selected | `chips`, `selected` | `chip:<label>` |

Row modifiers usable on any row: `shake: true` (error shake on arrival) and `badge: <n>`
(notification badge on the shape's top-right corner).

Props not listed have sensible defaults; every prop and default appears in the generated catalog.

## Authoring interface

```js
const states = () => [
  { at: 0,  use: 'button',  label: 'Import payslip', fill: 'accent' },
  { at: 2,  use: 'loader' },
  { at: 4,  use: 'check',   label: 'Imported' },
  { at: 6,  use: 'counter', from: 0, to: 2450, prefix: '£' },
  { at: 10, use: 'tabs',    items: ['Day', 'Week', 'Month'], active: 'Day' },
  { at: END - 2, use: 'button', label: 'Import payslip', fill: 'accent' },
];
const cursor = () => [
  { at: 0,   x: 240, y: 280 },
  { at: 1.5, target: 'button' },
  { at: 2,   target: 'button', press: true },
  { at: 12,  target: 'tab:Month', press: true },
  { at: END - 2, x: 240, y: 280 },
];
```

- `use` names a component; any other keys are its props, plus the existing row keys (`at`,
  and optional overrides `w`, `h`, `r`, `fill`, `ink` in theme roles).
- Rows without `use` keep working exactly as today (custom states with their own `.layer`).
- Cursor rows take either `x`,`y` (as today) or `target: '<hotspot>'`, optionally with
  `dx`,`dy` offsets. `press: true | 'down' | 'up'` and `sound` work as today.

## Architecture

```
skills/motion-video/components/
  core/engine.js         registry, row resolution, geometry tracks, layers, events, validation
  core/helpers.js        shared pure helpers (text enter/exit, draw-on stroke, roll digits, easing via springs)
  controls/*.js  feedback/*.js  data/*.js  chrome/*.js     one file per component
  modifiers.js           shake, badge
  CATALOG.md             generated (do not edit)
  RECIPES.md             hand-written starting sequences
  WRITING-A-COMPONENT.md hand-written authoring guide + template
  gallery/               a project that plays every component (used by tests and thumbnails)
  docs-images/           generated gallery thumbnails referenced by CATALOG.md
scripts/build_catalog.mjs   regenerates CATALOG.md (+ --check mode for tests)
scripts/gallery_stills.mjs  regenerates docs-images from the gallery
```

### Component module contract

Each component file is an ES module exporting:

```js
export const meta = {
  name, group, useWhen, motion, example,
  props: { propName: [typeDescription, defaultValue], ... },
  hotspots: ['name', 'prefix:<param>'],
  sounds: ['click' | 'key' | ...],          // what it may emit
};
export function geometry(props, ctx) -> { w, h, r, fill, ink }   // design px at a 1440 stage, theme roles
export function mount(layerEl, props, ctx)                        // build DOM once, at load
export function render(layerEl, props, ctx, t, local)             // pure: styles from t only
export function hotspot(name, props, geo) -> { x, y }             // offset from shape centre, design px
export function events(props, presses, ctx) -> derived timed data // optional: react to presses
```

`ctx` carries `beatT`, `beat_sec`, the house spring (`omega`, `zeta`), theme lookup, the
row's start/end times, and `presses` aimed at this row's hotspots. `local` gives seconds since the
row began and since it ended. `render` must follow every `seek(t)` rule (no timers, transitions,
`Date.now()`, or state written by earlier frames).

### Engine

- Loads components with static imports from a generated `components/index.js` (projects get a
  copy via `new_project.sh`, like `springs.js`).
- Resolves each `use` row: applies defaults, validates props, computes `geometry`, `mount`s its
  own layer (one layer per row), and builds the shape's geometry and colour tracks exactly as the
  template does today.
- Resolves cursor `target` rows to design-px positions using the target row's settled geometry,
  once at load; `seek(t)` stays pure.
- Collects presses aimed at a row's hotspots and hands them to `events`/`render` as static data.
- Merges declared sounds into `window.SFX`.
- Validation (throws through `window.ready` so render fails fast with a readable message):
  unknown component (with "did you mean" by edit distance), unknown prop (lists valid props),
  wrong prop type, unknown hotspot (lists that row's hotspots), target that no row provides,
  rows out of order, last row not equal to the first when the piece loops.

### Template changes

`template/index.html` gains `import { build } from './components/index.js'` and delegates
`use` rows to the engine; custom rows and all existing behaviour are unchanged. The current
template tests must keep passing.

## Documentation

- `CATALOG.md`, generated by `build_catalog.mjs` from every `meta`: one section per group; per
  component a thumbnail, use-when, props table with defaults, hotspots, motion, sounds, example.
- `RECIPES.md`: at least five complete `states`/`cursor` sequences (onboarding, checkout,
  dashboard tour, AI assistant reply, settings change), each validated by a test.
- `WRITING-A-COMPONENT.md`: a copyable template file, the contract above, a checklist, and the
  test to add.
- Skill updates: `motion-design` gains a "propose components" step (read CATALOG.md use-when
  lines, suggest one per beat, user approves) and plans name components; `motion-video` documents
  `use`/`target` rows and points to the catalog first; `CLAUDE.md`, README and the wiki page get a
  Components section; `CREDITS.md` stays current.

## Testing

- Per component (Node): meta completeness, defaults applied, geometry within stage, every
  declared hotspot resolves inside the shape, `render` deterministic (same t, same styles).
- Engine: each validation error and its message; "did you mean"; target resolution; press
  events reach the right row; sounds merged.
- Gallery render test: the gallery project renders a preview; seam check passes; purity check
  (identical pixels for a t sampled after different prior seeks) on a sample of components.
- `build_catalog.mjs --check` fails when CATALOG.md is stale.
- Every RECIPES.md sequence validates and renders a 1-bar preview.
- Existing suites keep passing (template behaviour unchanged for custom rows).

## Proof

`demos/04-library-reference`: demo 1's approved sequence rebuilt with library components only
(new project, same song window). Report lines of project-specific code versus demo 1 and build
time; render and seam check pass; contact sheet reviewed.

## Build order (for the plan)

1. Core: engine, helpers, modifiers, validation, index generation, catalog generator, gallery
   harness, template integration.
2. Controls (7). 3. Feedback (5). 4. Data (8). 5. App chrome (8).
6. Docs (recipes, authoring guide, skill + CLAUDE.md/README/wiki updates), proof demo 04.

## Roadmap (later sub-projects, each with its own spec and plan)

- **B. Export presets:** platform presets (Reels/TikTok/Shorts/X/Discord), safe-zone overlay and
  check, loudness normalisation, size-capped encodes, poster frame, WebM/GIF, captions.
- **C. Sync tools:** click-track overlay preview, grid nudge, tap-tempo, swing, tempo changes,
  non-4/4 time signatures.
- **D. Narrative pieces:** logo reveal, title cards, end card with call to action, audio
  fade-out for non-looping pieces (uses A and B).
- **E. Real-app footage format:** screenshots or live pages in device frames with camera, cursor
  and beat sync (uses A and B).
- **F. Hardening:** legibility/off-frame lint, duplicate-frame skipping, motion-ui guidance for
  React and Three.js, an update command.
