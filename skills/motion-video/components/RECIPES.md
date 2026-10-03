# Recipes

Five complete sequences built only from library components. Each is a 7-bar loop at 120 BPM
(28 beats, `END` is 28), and each block passes `check_brief.mjs` with no errors and no warnings:
every row holds at least 2 beats, there are at most 14 states, and something starts on every beat
up to the return at beat 26.

To use one: copy the block into your brief's `## Beat table` (or straight into `index.html`), change
the copy to your product's real words, then run `check_brief.mjs`. At another tempo or length the
beats move, so re-check: `min_hold_beats` and `max_states` come from your song.json.

How to read them:

- A row with `use:` is a component from [CATALOG.md](CATALOG.md); its other keys are that component's props.
- Two rows in a row with the same `use` are one component changing (a continuation), not a cut. The
  second row starts from where the first left off, so after a press, write the pressed result into
  it (a toggle pressed on is written `on: true`, tabs pressed to Month are written `active: 'Month'`).
- A cursor row with `target:` aims at a component's hotspot. A cursor row aimed at a hotspot one beat
  before a row starts aims at that next row (the cursor gets there early).
- Aiming the cursor at a chart point or an avatar is a hover: the component reacts while the cursor
  is aimed there and lets go when a later cursor row aims somewhere else.
- The last row repeats the first and the last cursor row repeats the first, 2 beats before `END`,
  so the loop is seamless.

### Onboarding

Use for: a sign-up or first-run flow (create an account, fill in a name, pick a setting, done).

```js
const states = () => [
  { at: 0,  use: 'button', label: 'Create account' },
  { at: 3,  use: 'input', placeholder: 'Your name', text: 'Sam Rivera', typeAt: 1.25, perChar: 0.2, icon: 'none' },
  { at: 7,  use: 'toggle', on: false, label: 'Notifications' },
  { at: 10, use: 'toggle', on: true, label: 'Notifications' },
  { at: 12, use: 'check', label: 'Profile saved' },
  { at: 15, use: 'check', label: 'Notifications on' },
  { at: 18, use: 'toast', text: 'Welcome, Sam', action: 'Later' },
  { at: 22, use: 'toast', text: 'Tour saved for later', icon: 'info' },
  { at: END - 2, use: 'button', label: 'Create account' },
];
const cursor = () => [
  { at: 0,   x: 240, y: 280 },
  { at: 1,   target: 'button' },
  { at: 2,   target: 'button', press: true },
  { at: 3,   target: 'field' },
  { at: 4,   target: 'field', press: true },
  { at: 5,   x: 220, y: 200 },
  { at: 6,   target: 'knob' },
  { at: 8,   target: 'knob', press: true },
  { at: 9,   x: 200, y: 230 },
  { at: 11,  x: 160, y: 180 },
  { at: 13,  x: 220, y: 240 },
  { at: 14,  x: 200, y: 200 },
  { at: 16,  x: 240, y: 160 },
  { at: 17,  target: 'action' },
  { at: 19,  target: 'action' },
  { at: 20,  target: 'action', press: true },
  { at: 21,  x: 220, y: 200 },
  { at: 23,  x: 240, y: 240 },
  { at: 24,  x: 200, y: 260 },
  { at: 25,  x: 230, y: 270 },
  { at: END - 2, x: 240, y: 280 },
];
```

### Checkout

Use for: a purchase or payment (review the basket, pay, wait, paid, receipt).

```js
const states = () => [
  { at: 0,  use: 'list', rows: [
    { title: 'Desk lamp', detail: 'Qty 1', value: '£48' },
    { title: 'Notebook set', detail: 'Qty 2', value: '£18' },
    { title: 'Delivery', detail: 'Tomorrow', value: '£4' },
  ] },
  { at: 4,  use: 'list', rows: [
    { title: 'Desk lamp', detail: 'Qty 1', value: '£48' },
    { title: 'Notebook set', detail: 'Qty 2', value: '£18' },
    { title: 'Delivery', detail: 'Tomorrow', value: '£4' },
    { title: 'Discount', detail: 'WELCOME10', value: '-£7' },
  ] },
  { at: 8,  use: 'button', label: 'Pay £63' },
  { at: 10, use: 'loader', fill: 'ink', ink: 'surface' },
  { at: 14, use: 'check', label: 'Payment sent' },
  { at: 18, use: 'toast', text: 'Receipt emailed', action: 'View' },
  { at: 22, use: 'toast', text: 'Opening receipt', icon: 'info' },
  { at: END - 2, use: 'list', rows: [
    { title: 'Desk lamp', detail: 'Qty 1', value: '£48' },
    { title: 'Notebook set', detail: 'Qty 2', value: '£18' },
    { title: 'Delivery', detail: 'Tomorrow', value: '£4' },
  ] },
];
const cursor = () => [
  { at: 0,   x: 240, y: 280 },
  { at: 1,   target: 'row:0' },
  { at: 2,   target: 'row:1' },
  { at: 3,   target: 'row:2' },
  { at: 5,   target: 'row:3' },
  { at: 6,   x: 220, y: 240 },
  { at: 7,   target: 'button' },
  { at: 9,   target: 'button', press: true },
  { at: 11,  x: 200, y: 230 },
  { at: 12,  x: 180, y: 200 },
  { at: 13,  x: 220, y: 220 },
  { at: 15,  x: 240, y: 180 },
  { at: 16,  x: 260, y: 140 },
  { at: 17,  target: 'action' },
  { at: 19,  target: 'action' },
  { at: 20,  target: 'action' },
  { at: 21,  target: 'action', press: true },
  { at: 23,  x: 220, y: 200 },
  { at: 24,  x: 200, y: 240 },
  { at: 25,  x: 230, y: 270 },
  { at: END - 2, x: 240, y: 280 },
];
```

### Dashboard tour

Use for: showing off an analytics or finance dashboard (a headline number, its trend, a breakdown,
a period switch, the takeaway, who it is shared with).

```js
const states = () => [
  { at: 0,  use: 'counter', from: 0, to: 12480, prefix: '£', label: 'Revenue this month' },
  { at: 2,  use: 'counter', to: 14920, prefix: '£', label: 'Revenue this month' },
  { at: 4,  use: 'line-chart', label: 'Revenue', points: [8, 9, 8.5, 11, 10, 12.5, 12, 14.9], format: { prefix: '£', suffix: 'k', decimals: 1 } },
  { at: 8,  use: 'bar-chart', label: 'Orders', bars: [
    { label: 'Mon', value: 32 }, { label: 'Tue', value: 41 }, { label: 'Wed', value: 38 }, { label: 'Thu', value: 56 }, { label: 'Fri', value: 49 },
  ] },
  { at: 11, use: 'tabs', items: ['Day', 'Week', 'Month'], active: 'Day' },
  { at: 13, use: 'tabs', items: ['Day', 'Week', 'Month'], active: 'Month' },
  { at: 15, use: 'card', title: 'Best month so far', figure: '£14,920', body: 'Up 19% on last month' },
  { at: 19, use: 'avatar-stack', people: ['AK', 'JW', 'MS', 'LT'], extra: 2 },
  { at: END - 2, use: 'counter', from: 0, to: 12480, prefix: '£', label: 'Revenue this month' },
];
const cursor = () => [
  { at: 0,   x: 240, y: 280 },
  { at: 1,   x: 200, y: 230 },
  { at: 3,   x: 160, y: 200 },
  { at: 5,   target: 'point:3' },
  { at: 6,   target: 'point:5' },
  { at: 7,   target: 'point:7' },
  { at: 8,   target: 'bar:Tue' },
  { at: 9,   target: 'bar:Tue', press: true },
  { at: 9.5, target: 'bar:Thu' },
  { at: 10,  target: 'bar:Thu', press: true },
  { at: 11,  target: 'tab:Month' },
  { at: 12,  target: 'tab:Month', press: true },
  { at: 14,  x: 220, y: 220 },
  { at: 16,  x: 240, y: 200 },
  { at: 17,  x: 200, y: 160 },
  { at: 18,  x: 180, y: 140 },
  { at: 20,  target: 'avatar:0' },
  { at: 21,  target: 'avatar:1' },
  { at: 22,  target: 'avatar:2' },
  { at: 23,  x: 220, y: 200 },
  { at: 24,  x: 200, y: 240 },
  { at: 25,  x: 230, y: 270 },
  { at: END - 2, x: 240, y: 280 },
];
```

### AI assistant reply

Use for: a chat or assistant feature (ask a question, it thinks, it answers, you pick a follow-up).

```js
const states = () => [
  { at: 0,  use: 'input', placeholder: 'Ask anything', icon: 'none' },
  { at: 2,  use: 'input', placeholder: 'Ask anything', text: 'What did I spend on travel?', typeAt: 0.25, perChar: 0.1, icon: 'none' },
  { at: 6,  use: 'loader', style: 'dots', fill: 'ink', ink: 'surface' },
  { at: 9,  use: 'card', title: 'Travel in March', figure: '£412', body: 'Mostly train fares, 6 trips' },
  { at: 13, use: 'chip-row', chips: ['Compare months', 'Set a budget', 'Show trips'], selected: [] },
  { at: 17, use: 'chip-row', chips: ['Compare months', 'Set a budget', 'Show trips'], selected: ['Set a budget'] },
  { at: 19, use: 'toast', text: 'Budget set: £400 a month' },
  { at: END - 2, use: 'input', placeholder: 'Ask anything', icon: 'none' },
];
const cursor = () => [
  { at: 0,   x: 240, y: 280 },
  { at: 0.5, target: 'field' },
  { at: 1,   target: 'field', press: true },
  { at: 3,   x: 260, y: 200 },
  { at: 4,   x: 240, y: 220 },
  { at: 5,   x: 220, y: 240, sound: 'key' },   // Enter: sends the question
  { at: 7,   x: 200, y: 230 },
  { at: 8,   x: 220, y: 200 },
  { at: 10,  x: 240, y: 180 },
  { at: 11,  x: 200, y: 160 },
  { at: 12,  x: 160, y: 150 },
  { at: 14,  target: 'chip:Compare months' },
  { at: 15,  target: 'chip:Set a budget' },
  { at: 16,  target: 'chip:Set a budget', press: true },
  { at: 18,  x: 220, y: 200 },
  { at: 20,  x: 240, y: 220 },
  { at: 21,  x: 200, y: 240 },
  { at: 22,  x: 220, y: 260 },
  { at: 23,  x: 240, y: 250 },
  { at: 24,  x: 220, y: 270 },
  { at: 25,  x: 230, y: 280 },
  { at: END - 2, x: 240, y: 280 },
];
```

### Settings change

Use for: changing a setting and seeing it take effect (open settings, flip a switch, choose an
option, it syncs, the app confirms).

```js
const states = () => [
  { at: 0,  use: 'dock', active: 'Today' },
  { at: 2,  use: 'dock', active: 'Settings' },
  { at: 4,  use: 'toggle', on: false, label: 'Dark mode' },
  { at: 7,  use: 'dropdown', label: 'Currency', items: ['GBP', 'EUR', 'USD'], selected: 'GBP' },
  { at: 9,  use: 'dropdown', label: 'Currency', items: ['GBP', 'EUR', 'USD'], open: true, selected: 'GBP' },
  { at: 11, use: 'dropdown', label: 'Currency', items: ['GBP', 'EUR', 'USD'], selected: 'EUR' },
  { at: 13, use: 'status', level: 'warn', text: 'Syncing' },
  { at: 16, use: 'status', level: 'ok', text: 'Synced' },
  { at: 18, use: 'banner', app: 'Settings', title: 'Currency changed', body: 'Prices now show in euros', icon: 'info' },
  { at: END - 2, use: 'dock', active: 'Today' },
];
const cursor = () => [
  { at: 0,    x: 240, y: 280 },
  { at: 0.5,  target: 'item:Settings' },
  { at: 1,    target: 'item:Settings', press: true },
  { at: 3,    target: 'knob' },
  { at: 5,    target: 'knob', press: true },
  { at: 6,    x: 200, y: 200 },
  { at: 7,    target: 'trigger' },
  { at: 8,    target: 'trigger', press: true },
  { at: 9,    target: 'item:EUR' },
  { at: 10,   target: 'item:EUR', press: true },
  { at: 12,   x: 220, y: 220 },
  { at: 14,   x: 240, y: 200 },
  { at: 15,   x: 220, y: 180 },
  { at: 17,   x: 200, y: 160 },
  { at: 19,   target: 'banner' },
  { at: 20,   target: 'banner', press: true },
  { at: 21,   x: 220, y: 200 },
  { at: 22,   x: 240, y: 220 },
  { at: 23,   x: 220, y: 240 },
  { at: 24,   x: 200, y: 260 },
  { at: 25,   x: 230, y: 270 },
  { at: END - 2, x: 240, y: 280 },
];
```
