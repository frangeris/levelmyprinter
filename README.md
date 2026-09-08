# Level My Printer

**Manual mesh bed leveling from the browser, over USB.** Move the nozzle to every
grid point, feel the paper drag, nudge Z until it is right, press Enter, repeat.
The app writes the corrected mesh back to the printer and reads it back to make
sure it took.

No backend, nothing to install. Open the page in Chrome, plug in the printer,
connect.

> **[Open the app →](https://frangeris.github.io/levelmyprinter/)**

---

## Why

Auto bed leveling is good, but it is not the whole story. On a printer whose
probe is the nozzle itself (a load-cell probe, like the CR-10 Smart) two `G29`
runs on the same bed give the same *shape* offset by roughly a tenth of a
millimetre, and a speck of filament on the tip skews the whole mesh. That
tenth is exactly the difference between a first layer that grips and one that
peels.

The paper check catches what the probe misses, but doing it by hand on a 5×5
grid means typing twenty-five sets of coordinates into a terminal, keeping
track of which point you are on, and copying numbers into a notebook.
Nobody does that twice.

Level My Printer turns the paper check into a keyboard pass: the bed is drawn
to scale, the head goes to each point by itself, the arrows move Z, and Enter
captures the value and moves on. Nothing touches the printer's memory until
the whole grid is done and you have reviewed it side by side with the mesh
that is already there.

## How it works

Everything runs client-side over the [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API).
The browser opens the USB port, the app talks Marlin G-code, and a strictly
sequential command queue waits for the firmware's real `ok` before sending the
next line.

On connect the printer is interviewed with three read-only commands (`M115`,
`M211`, `M503`) and the answers build the profile: machine name, travel
limits, grid size, leveling system, fade height, probe offset, preheat preset.
Nothing is drawn until the machine has said what it is.

The grid position is the one thing no command reports. Under ABL Bilinear the
bounds live in EEPROM and are set by the last `G29`, so the app dictates them
instead of guessing: an auto-level run with the bounds spelled out
(`G29 L20 R280 F20 B280`) pins the points, and from then on index ↔ millimetre
is plain arithmetic. Compensation is switched off (`M420 S0`) before any paper
measurement, otherwise you would be measuring the old mesh stacked on top of
the new one.

Captured values stay in the tab (and survive a reload) until you write. The
write is one `M421 I J Z` per point, then `M500` to persist, `M501` to reload
from EEPROM, and `M503` to read back and compare every value. A write that did
not survive a reload is reported as a mismatch, point by point.

```
src/
  serial/      Web Serial: connection, line parsing, command queue
  printer/     Pure domain: discovery, mesh geometry, G-code, leveling strategies
  printers/    Per-model profiles + the raw firmware capture they came from
  features/    UI
  state/       Zustand stores, session persistence, drafts
```

`serial/` knows nothing about leveling, `printer/` knows nothing about the UI,
and the UI never writes G-code directly. It consumes a `LevelingStrategy`, so
supporting MBL, UBL or Klipper means adding one file under `printer/leveling/`.

## How

<!-- TODO: GIF of the paper check at one point: slide the sheet, press ↓ until it drags, press Enter -->
![Paper leveling pass](docs/paper-leveling.gif)

1. **Connect.** Pick the USB port. The app homes the printer and shows what it
   learned about it.
2. **Preheat.** Bed and nozzle go to the profile's preset (editable). Saving a
   point is disabled while the printer is cold: a cold bed is a different
   surface from the one you print on.
3. **Auto-level once.** Runs the firmware's own `G29` with the grid bounds
   pinned. This is the starting mesh you will correct by hand.
4. **Walk the grid.** The head lifts, travels to the point, and descends to
   0.2 mm. Slide a sheet of paper under the nozzle and nudge Z down until the
   paper drags with light friction.
5. **Enter.** The value is captured, the point turns green, and the head moves
   to the next one. Twenty-five times.
6. **Review and write.** Current mesh beside the new one, the exact command
   list on demand, then one click writes, persists, reloads and verifies.

### Keyboard

The pass is twenty-five identical gestures, so your hands never leave the
keyboard.

| Key | Action |
|---|---|
| `↑` / `↓` | Raise / lower Z by the active step |
| `←` / `→` | Previous / next point (the head moves) |
| `Enter` | Save the point and advance. On a full grid, open the review |
| Click a point on the bed | Jump straight to it |

**Using the cursor while leveling.** Every `↑` or `↓` sends an *absolute* Z
(`G1 Z-0.120 F120`), never a relative one, so what you see on screen is what
the printer is at and no drift accumulates. The step selector (`0.01`, `0.05`,
`0.1` mm) sets how far each press moves. The usual rhythm: come down in `0.1`
until the paper starts to catch, then `0.01` until the friction is right. The
Z field is also editable: click it, type a value, press Enter.

**Enter.** While any point is still pending, Enter saves the current value
and moves the head to the next pending point. Once the whole grid is
measured, Enter opens the review instead. Enter does nothing while the printer
is busy moving, while it is cold, or while a dialog is open, so a stray press
never captures a point behind a modal.

**Colours on the bed.** Grey hollow: not yet measured. Black: the point you
are on. Green with a tick: measured by hand. Green ring, no tick: loaded from
the printer and not yet checked.

### Supported printers

| Model | Firmware | Leveling system | Grid | Probe |
|---|---|---|---|---|
| Creality CR-10 Smart | Marlin 1.0.14 (Creality) | ABL Bilinear | 5×5 | Load cell (nozzle is the probe) |

Any Marlin printer that reports **ABL Bilinear** in `M503` and accepts `M421`
should work: the profile is built from what the printer says on connect, and
the CR-10 Smart profile is only a fallback for values the firmware does not
report. Printers running **MBL**, **UBL** or **Klipper** are detected and
refused with a clear message: every system stores its mesh with a different
command, and writing the wrong one silently writes nothing.

Every hand-written profile in `src/printers/` sits next to a `.capture.txt`
holding the raw firmware dump its values came from, so every number is
auditable in the diff.

### Commands used

| Phase | Command | What it does |
|---|---|---|
| Connect | `M115` | Firmware, machine type, UUID, capabilities |
| | `M211` | Soft endstops (travel limits) |
| | `M503` | Settings dump: mesh, steps/mm, feedrates, fade height, probe offset, preheat presets |
| Prepare | `M140` / `M104` then `M190` / `M109` | Preheat bed and nozzle in parallel, then wait |
| | `G28` | Home |
| | `G29 L R F B` | Auto-level with the grid bounds pinned. **Auto-saves to EEPROM on this firmware** |
| | `M420 S0` | Disable compensation before measuring |
| | `G90` | Absolute positioning |
| Go to point | `G1 Z5 F300` → `G1 X Y F3000` → `G1 Z0.2 F300` | Lift, travel, descend. Never drags the nozzle across the glass |
| Jog | `G1 Z{abs} F120` | Absolute Z, clamped to the profile's safety range |
| Write | `M421 I J Z` × N | One point each, five decimals |
| | `M500` | Persist to EEPROM |
| | `M501` | Reload from EEPROM (so the read-back proves the save) |
| | `M503` | Read back and compare |
| | `G1 Z5` + `M420 S1` | Release the bed, re-enable compensation |

**Why `M421` and not `G29 W`.** `M503` serialises the mesh as `G29 W I J Z`
lines that look replayable, but on this firmware each `G29 W` zeroes the grid
before setting its own point: replay twenty-five and only the last survives.
`M421` sets one point and leaves the rest alone. Verified against the
hardware, after it destroyed a measured mesh twice.

## Requirements

- Desktop **Chrome, Edge or Opera**, or **Firefox 151+**. Safari does not
  support Web Serial and never will.
- A secure context: `https://` or `localhost`. Served over a plain IP without
  TLS, `navigator.serial` is `undefined`.
- The printer plugged into **the machine running the browser**. The serial
  port is opened by the client, not by any server.

## Development

```bash
npm install
npm run dev          # http://localhost:5173
npm run dev:lan      # HTTPS on the LAN, self-signed cert (accept the warning)
npm test             # unit tests
npm run typecheck
npm run build
```

`dev:lan` matters because Web Serial only exists in a secure context. Vite
prints the URL (`https://192.168.x.x:5173`); on the other machine accept the
certificate warning.

### Adding a printer

1. Connect it and open **Printer details** in the header: everything the app
   read is listed with the command it came from.
2. Capture `M115`, `M503`, `M211`, `M420 V1` into
   `src/printers/<model>.capture.txt`.
3. Write the profile in `src/printers/<model>.ts`, derived from the capture,
   and add it to `registry.ts`.

### Deploying

Pushes to `main` build and publish to GitHub Pages through
`.github/workflows/deploy.yml`. The Vite `base` is taken from the repository
name automatically, so a fork deploys under its own path with no changes.
Pages is served over HTTPS, which is what Web Serial needs.

To enable it once: **Settings → Pages → Source: GitHub Actions**.

## Safety

- Z is hard-clamped to the profile's `[zMin, zMax]`.
- The nozzle never moves in XY without lifting to the travel height first.
- Nothing is written to the printer until you confirm the review.
- The write reloads from EEPROM before verifying, so a failed `M500` shows up
  as a mismatch instead of a false success.
- `G29` on this firmware auto-saves. Before running one, the current mesh can
  be loaded into the app as a backup draft.

## Status

Connect, discover, drive the printer point by point, capture, review, write
and verify all work on the CR-10 Smart. See [PLAN.md](PLAN.md) for the design
decisions and the risks that were resolved against the hardware.
