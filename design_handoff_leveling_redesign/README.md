# Handoff: bed-leveling UI redesign

## Overview

A visual and structural redesign of Level My Printer — the point-by-point bed
leveling pass. Same domain logic, same flow, same G-code: what changed is the
layout, the type, the palette, and how much of it there is. The old UI was a
Bootstrap-shaped stack of bordered panels; this one has no boxes, and hierarchy
comes from scale and space.

Nothing under `src/serial/`, `src/printer/`, `src/printers/` or `src/state/`
changes. One optional one-line change in `src/features/leveling/sequences.ts`
is described at the end.

## About the design files

`Level My Printer.dc.html` in this bundle is the **design reference** — a
working HTML prototype of the intended look and behaviour, with fake data. It
is not the code to ship.

The `src/` files in this bundle **are** meant to go into the repo: they are
TypeScript/React written against the existing hooks and stores, in the project's
own conventions (CSS classes in one stylesheet, no CSS-in-JS, no new
dependencies). Drop them in, replacing the files of the same path. They have
not been run through `tsc` or the test suite — do that first.

## Fidelity

**High fidelity.** Exact colors, type, spacing and interaction states. The
prototype is the source of truth for anything the code leaves ambiguous.

## Files to replace

| Path | What changed |
|---|---|
| `src/styles.css` | Full rewrite: new tokens, new component classes |
| `src/App.tsx` | New layout; owns the preheat and disconnect dialogs; the status strips moved here |
| `src/features/header/Header.tsx` | One row; printer is a `<select>`; readouts centred; status light replaces the label + Disconnect button |
| `src/features/bed/BedView.tsx` | Bed silhouette with front ears; ticks in captured dots; values as HTML overlay |
| `src/features/controls/LevelingControls.tsx` | Rewritten as the working column; owns the keyboard bindings and the Restart confirm |
| `src/features/terminal/Terminal.tsx` | Collapsible, no timestamps, no Send button, no quick-command row |
| `src/features/review/MeshReview.tsx` | Change column and both explainer paragraphs dropped |

New files:

| Path | What it is |
|---|---|
| `src/features/controls/PreheatDialog.tsx` | Preheat with editable temperatures, extracted from LevelingControls |
| `src/features/connect/DisconnectDialog.tsx` | Confirm, opened by clicking the status light |

Unchanged, still used as-is: `HeatProgress.tsx` (its `.heat*` class names are
restyled in the new stylesheet), `ConnectGate.tsx`, `HomeModal.tsx`,
`BrowserCheck.tsx`. `ConnectGate` and `HomeModal` will pick up the new dialog
styling only if their markup is moved from `.modal` / `.notice__actions` to
`.dialog` / `.dialog__actions` — a class rename, no logic.

## Design tokens

All in `:root` in `src/styles.css`.

**Ground and ink**

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0c0c0d` | page |
| `--surface` | `#1a1a1c` | dialogs, inputs |
| `--inset` | `#0c0c0d` | note blocks inside dialogs (a step darker than the dialog) |
| `--text` | `#fbfafa` | body, and the active point |
| `--divider` | `rgb(251 250 250 / 0.18)` | hairlines, input and outline-button borders |
| `--n-300` | `#38383b` | bed grid lines |
| `--n-400` | `#66666a` | bed outline, pending dot stroke, placeholders |
| `--n-600` | `#b4b4b8` | small-caps labels, muted copy |
| `--n-700` | `#d8d8db` | — |

**Accents** — cyan is the only interactive color; magenta is the rarer second
spot, used for the destructive strip and mismatch cells; green is the one
addition outside the two process inks, and carries exactly two meanings:
captured and connected.

| Token | Value | Use |
|---|---|---|
| `--accent` | `#00b8f0` | primary button fill, selected step, caret |
| `--accent-hover` | `#22ccff` | primary hover |
| `--accent-press` | `#5fdcff` | primary active |
| `--accent-tint` | `#04202c` | busy strip background |
| `--accent-ink` | `#a6ecff` | links, ghost buttons, `> ` outgoing log lines |
| `--warn-tint` | `#33021a` | quick-mode strip background |
| `--warn-ink` | `#ffe0ea` | text on that strip, mismatch cells |
| `--ok` | `#00e07a` | captured dots and their values, status light, the verified tick |

**Type** — one family, `Source Serif 4` (400 / 600 / 400 italic), loaded from
Google Fonts by the `@import` at the top of the stylesheet. No sans anywhere;
the serif is the chrome. Monospace (`ui-monospace, 'SF Mono', Menlo`) only for
machine output: the log, G-code inputs, command lists.

| Role | Size / weight | Notes |
|---|---|---|
| Z value | `min(80px, 7vw, 10vh)`, 600, `letter-spacing: -0.03em` | tabular figures; scales with the viewport so it never clips |
| Printer select | 17px, 600 | reads as the page title |
| Dialog title | 32px, 600, `-0.015em` | |
| Body | 15px / 1.55 | |
| Section label (`.label`) | 13px, 600, `0.08em`, uppercase | "Point 8 of 25", "Z offset", "Step", "Terminal" |
| Readouts, coords | 13px, tabular | |
| Bed values | 13px, tabular; 600 when active | |
| Log | 11.5px mono / 1.6 | |

**Spacing** `--s1`…`--s8`: 5 / 10 / 15 / 20 / 30 / 40 px (the system's 1.25×
scale — do not tighten it). **Radius** 2px everywhere; 4px on dialogs, 50% on
the status light and the "?".

## Screens

### Workspace — the only screen

```
header:  ● [Creality CR-10 Smart ▾]   Nozzle · Bed · X · Y · Z   [ Preheat ]
strip:   (quick mode / preheating, full width, only when it applies)
main:    grid  minmax(0,1fr)  |  clamp(300px, 26vw, 380px)   gap 40px
         ┌──────────────────────┐   POINT 8 OF 25
         │        bed           │   I2 J1 · X150 Y85 · 7 captured
         │                      │   Z OFFSET
         │                      │   0.050   [▲]
         └──────────────────────┘           [▼]
          X0 Y0                    STEP  [0.01|0.05|0.1]
                                   [← Previous][Next →]
                                   [        Save       ]
                                   ↑ ↓ nudge · ⏎ save · ← → point
                                   Restart
                                   ▶ TERMINAL (?)
```

**Header.** One row, `white-space: nowrap`. The status light is a 14px circle
button: green when connected, and clicking it is the only way to disconnect —
the old "Connected" label plus a Disconnect button said the same thing twice.
The printer is a `<select>` (disabled once connected: the grid depends on it),
sitting 5px from the light so they read as one unit. The readouts are centred by
`flex: 1; justify-content: center`, and are the only shrinkable item.

**Bed.** `.bed-frame` is a square whose box **is** the bed rectangle, so the
HTML value labels can be positioned in percentages of it and stay in register
with the SVG at any size. The SVG uses `viewBox="0 0 width depth"` — 1 unit =
1 mm — and `overflow: visible` so the ears can hang below.

- Outline: one closed path including the two front ears, 1px `--n-400`, corners
  rounded 6mm. Ears are inset 28mm from each side, 54mm wide, 10mm deep. They
  are what tells you which edge faces you — the "▼ front of the printer"
  caption is gone.
- Grid lines between the mesh points, 0.8px `--n-300`.
- Dots: pending 5mm radius, hollow (`--bg` fill, `--n-400` 1.2px stroke);
  captured 7.5mm solid `--ok` with an 11px `✓` in `--bg` centred on it; active
  7.5mm solid `--text`.
- Values: 13px tabular, `--ok` when captured and `--text` 600 when active,
  offset **3.6% of the bed** from the dot centre — measured in bed units, not
  ems, so the clearance holds at any rendered size. The front row prints above
  its dot; below would land on the front edge and the ears.
- Clicking any dot jumps to that point.

**Controls column.** `overflow-y: auto` with `scrollbar-gutter: stable`, so a
short viewport scrolls rather than hiding the actions. The point block is
`flex: 0 0 auto`, the actions block `flex-shrink: 0`, the terminal
`flex: 1 1 auto; min-height: 0` — the terminal is the only part that gives up
space, and the primary actions can never be the part that gets cut.

- Step is a segmented control on native radios; the checked fill comes from
  `:has(input:checked)`.
- Previous / Next split the row at 50% each. Save is full width below them.
- **Save becomes "Continue" when all 25 points are captured**, and that click
  opens the review. There is no separate "Save to printer" button and no "All
  points captured" banner — the button carries the pass forward.
- "Restart" is a ghost link under the shortcut hint, and always confirms first,
  naming how many values will be discarded.

**Terminal.** Collapsed by default, at the bottom of the column. The bar is
"▼ TERMINAL" (caret rotated -90° when closed) plus a round "?" that opens the
common-commands dialog. Open, the log fills the leftover height and the input
is pinned below it. No timestamps, no Send button (Enter submits), no row of
quick-command buttons — they live in the "?" with a line each saying what they
report. Up/down arrow history is kept.

### Dialogs

All on `.dialog` — `--surface`, 4px radius, `0 12px 32px rgb(0 0 0 / 0.7)`,
30px padding, 15px gaps, actions right-aligned with a flex spacer. Backdrop
`rgb(0 0 0 / 0.75)`.

| Dialog | Opened by | Content |
|---|---|---|
| Connect | not connected | unchanged flow: browser check, printer select, Connect |
| Home | connected, not homed | unchanged: mandatory, closes when `leveling.homed` flips |
| Preheat | header button | two number fields (Nozzle °C / Bed °C, defaults from `profile.preheat`), one note, Cancel / **Continue** |
| Disconnect | status light | one line, Cancel / Disconnect |
| Common commands | terminal "?" | six read-only commands, clicking one sends it and closes |
| Save to printer | Save→Continue, or Enter when complete | Point / Current / New table, commands toggle, Cancel / Write N points |
| Written | after the write | `✓ Mesh written and verified`, one line, the command trail `M421 ×25 → M500 → M501 → M503` |

The review dialog is `height: min(86vh, 720px)` with `min-height: 0`, and the
table wrapper takes the leftover space via `flex: 1 1 auto; min-height: 0` —
give it a fixed floor instead and it overflows the dialog on short viewports.
The commands toggle sits **in** the actions row rather than above it, so the
table is what grows.

## Interactions

- `↑` / `↓` nudge Z by the selected step. `←` / `→` change point. `⏎` saves,
  or opens the review when the grid is full.
- Bindings live in `LevelingControls` on a `window` `keydown` listener. They
  bail out while typing in a text input, textarea or select — but **not** for
  radios: a focused step radio would otherwise consume the arrows and move the
  selection instead of Z. That was a real bug; the step control also blurs
  itself on change.
- Bindings are suppressed while the restart confirm is open or the machine is
  busy. Dialog-level suppression is handled by `inert` on `<main>`.
- No animation anywhere. The pulsing ring on the active point and the breathing
  status dot were both cut: motion beside a number you are trying to read by
  hand is a distraction.

## State

No new global state. Local component state added:

| Where | State |
|---|---|
| `App` | `preheatOpen`, `disconnectOpen` |
| `LevelingControls` | `confirmRestart` |
| `Terminal` | `open`, `help`, plus the existing draft/history |
| `PreheatDialog` | `nozzle`, `bed` |
| `MeshReview` | `showCommands` |

`BedView` takes one new prop, `zTarget`, so the active point can print the
value being tried rather than the stored one.

## Two things to decide

**1. The G29 "pin the grid" option is parked.** The old preheat dialog had a
second checkbox, *Probe the bed and pin the grid (G29)*. It is not in this
design. It is worth keeping the reasoning:

- `M421 I.. J.. Z..` only fills a grid cell that already exists — it does not
  create the grid.
- `G29 L20 R280 F20 B280` is what defines that grid: 5×5, points at
  20/85/150/215/280, the coordinates the bed diagram draws.
- It also leaves a probed mesh behind, which is where the review's **Current**
  column comes from.
- It cannot move to the end of the flow: G29 fills the mesh with the machine's
  own probed values, so running it after a manual pass erases everything the
  user just measured.
- But the grid lives in EEPROM and survives a power cycle, so it is needed
  **once per printer**, not once per session. The old code warned whenever it
  had not run *in the current session*, which is stricter than the firmware
  requires.

If it comes back, the honest framing is a separate one-time action — "Pin the
grid, first time only" — not a checkbox beside preheat, which implies it belongs
to every pass.

**2. The temperature fields need one change to mean anything.**
`PreheatDialog` calls `leveling.prepare({ preheat: true, probe: false, nozzle, bed })`.
For those overrides to reach the machine, `PrepareOptions` needs the two
optional fields and `buildPrepareSteps` needs to read them:

```ts
// sequences.ts
export interface PrepareOptions {
  preheat: boolean
  probe: boolean
  nozzle?: number
  bed?: number
}

// inside buildPrepareSteps, where the preheat step is built:
const nozzle = options.nozzle ?? profile.preheat?.nozzle
const bed = options.bed ?? profile.preheat?.bed
```

Until then the fields are display-only and the profile's `M145` values are used.
Either finish it or make the fields read-only — showing an editable number that
is ignored is worse than showing neither.

## Assets

None. No images, no icon library. The three glyphs used (`✓`, `▲▼`, `←→`) are
text characters. The single web font comes from Google Fonts via the
stylesheet's `@import`.
