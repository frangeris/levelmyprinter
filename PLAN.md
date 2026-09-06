# Plan — Level My Printer (web)

## 1. Goal
Web app (Vite + React, **no backend**) that guides manual mesh leveling point by point, with the bed drawn on screen:

1. Pick the printer from a **select at the top** (v1: only the Creality CR-10 Smart).
2. The app draws the **bed to scale** with that printer's mesh points.
3. Move between points with **Previous / Next**; at each one **raise and lower Z in hundredths** (the paper technique) until the measurement is right.
4. **"Save"** captures that point's value, turns it **green** and **advances automatically** to the next.
5. Once all 25 points are captured two buttons appear: **"Start over"** and **"Save to printer"** (writes the 25 values + `M500`, replacing the current mesh).

All communication goes over USB via the **Web Serial API**, client-side, nothing to install.

**v1 scope**: **ABL Bilinear** — which is what the CR-10 Smart actually runs, confirmed against the hardware (see `src/printers/creality-cr10-smart.capture.txt`). Writing goes through `G29 W I J Z` + `M500`, endorsed by the printer's own `M503`, which serializes its mesh as exactly those lines. The architecture stays open to other printers and other leveling systems (MBL, UBL, Klipper) without touching either the serial layer or the UI — see 4 and 5.3.

## 2. Tech stack
- **Vite + React + TypeScript**
- **Web Serial API** (`navigator.serial`) — all communication is client-side
- State: **Zustand** (lightweight, no backend needed)
- Bed and points: **SVG** (scale, hit-testing and animation for free; no canvas)
- Persistence: `localStorage` only for UI preferences (last printer picked, baud rate, jog step) and to **recover a half-finished leveling session** if the tab reloads. The real mesh lives in the printer's EEPROM.
- Deploy: static (Vercel/Netlify/GitHub Pages)

## 3. Browser requirements (show a warning when unmet)
- Desktop Chrome / Edge / Opera, or **desktop Firefox 151+** (May 2026)
- Safari: unsupported, and never will be
- HTTPS mandatory in production (or `localhost` in dev)

## 4. Printer profiles — what feeds the select

### 4.1 Two layers: evidence + typed profile
```
src/printers/
  creality-cr10-smart.capture.txt   ← raw command output (committed)
  creality-cr10-smart.ts            ← typed profile, derived from the capture
```
The `.capture.txt` is the **evidence**: where every number came from, auditable in the diff. The `.ts` is what the app consumes.

The app **does not parse the capture at runtime**: Marlin's text is free-form and brittle to parse, and safety limits are the last thing you want emerging from a regex with no human review. The capture is translated into a profile once, with eyes on it.

After a firmware update: capture again, diff it, adjust the profile.

### 4.2 Type
```ts
// printers/types.ts
interface PrinterProfile {
  id: string;                 // 'creality-cr10-smart'
  label: string;              // 'Creality CR-10 Smart'
  baudRate: number;           // 115200
  bed: { width: number; depth: number };            // mm — to draw to scale
  travel: { min: Vec3; max: Vec3 };                 // real limits (M211)
  mesh: {
    cols: number; rows: number;                     // 5 × 5
    min: { x: number; y: number };                  // first grid point
    max: { x: number; y: number };                  // last grid point
    order: 'serpentine' | 'rowMajor';
  };
  leveling: 'bilinear';       // LevelingStrategy id (5.3)
  fadeHeight: number;         // M420 Z — height at which compensation fades out
  jog: { steps: number[]; feedrate: number };
  feedrates: { travelXY: number; travelZ: number }; // mm/min, clamped to M203
  safety: { zSafe: number; zStart: number; zMin: number; zMax: number };
  preheat?: { nozzle: number; bed: number };
}
```

### 4.3 Values derived from the capture (CR-10 Smart)
| Field | Value | Source |
|---|---|---|
| `label` | Creality CR-10 Smart | `M115 MACHINE_TYPE` |
| `bed` | 300 × 300 | nominal (travel reaches 305) |
| `travel` | X −2…305, Y −10…305, Z 0…405 | `M211` |
| `mesh.cols/rows` | 5 × 5 | `M503` (I0–I4, J0–J4) |
| `mesh.min/max` | **20 / 280** (set by the app) | `G29 L20 R280 F20 B280` — see 10.1 |
| `leveling` | `bilinear` | `M420 V1` → "Bilinear Leveling Grid" |
| `fadeHeight` | 2.00 | `M420 S1 Z2.00` |
| `feedrates.travelZ` | **300 mm/min** | `M203 Z5.00` (5 mm/s is the ceiling) |
| `feedrates.travelXY` | 3000 mm/min | `M203 X500 Y500` (plenty of headroom) |
| `jog.steps` | 0.01 / 0.05 / 0.1 | `M92 Z400` → 0.0025 mm resolution |
| `preheat` | 200 / 60 | `M145 S0` |

**Values that do NOT come from the capture** and are decided by hand: `safety.zMin` (a safety policy, not a firmware fact), `safety.zSafe`, `jog.steps` (a UI preference), `mesh.order`.

Hardware notes relevant to the flow:
- **`M851 X0 Y0 Z0.31`** → the probe is a **load cell**: the nozzle itself is the probe (confirmed by the `Taring probe` messages, Marlin's `PROBE_TARE` feature). There is no XY offset to compensate for, and the probe measures exactly what the paper does: real physical contact.
- **Catmull-Rom 13×13 subdivision** → the firmware's internal interpolation. It does not change what gets written: we still send the 25 base grid points.

### 4.4 "Calibrate a new printer" mode
The app runs the command round itself, performs the grid discovery and offers the finished profile for download, ready to commit. Adding a printer goes from "track down its `Configuration.h`" to "plug it in and press a button" — turning risk #1 (section 10) into a feature.

### 4.5 Registry
```ts
export const PRINTERS: PrinterProfile[] = [CR10_SMART];   // v1: just one
```
The header select swaps the active profile → **the bed is redrawn, the grid changes and the session resets** (with confirmation if any points were captured).

## 5. Module architecture

### 5.1 `serial/` — communication layer
- `connect.ts` → `navigator.serial.requestPort()`, `port.open({ baudRate })` (from the profile)
- `commandQueue.ts` → strictly sequential FIFO queue: Marlin processes one command at a time, the real `ok` must be awaited before sending the next. Timeout + abort.
- `protocol.ts` → line parsing (`ok`, `echo:`, `busy:`, `wait`, `X:… Y:… Z:…` from `M114`, errors)
- Port disconnect/reconnect handling

### 5.2 `printer/` — domain model (pure, testable functions)
- `types.ts` → `MeshPointGeometry { i, j, pos }`, `MeshPointStatus`
- `meshGeometry.ts` → given a `PrinterProfile`, generates the points: index `(i,j)` → physical position `(x,y)` + **traversal order** (serpentine) + **screen coordinate** (note: bed Y grows toward the back, SVG Y grows downward → Y must be flipped so the drawing matches what someone standing in front of the printer sees)
- `gcodeBuilders.ts` → movement, home, temperature (generic Marlin, independent of the leveling system)

### 5.3 `printer/leveling/` — adapter per leveling system
```ts
interface LevelingStrategy {
  id: 'bilinear' | 'mbl' | 'ubl' | 'klipper';
  buildSetupGrid: (profile: PrinterProfile) => string[];  // pins the grid bounds
  buildEnable: (on: boolean) => string;                   // compensation on/off
  buildWritePoint: (i: number, j: number, z: number) => string;
  buildPersist: () => string;                             // persist to EEPROM
  buildVerify: () => string;                              // re-read to verify
}
```
- `bilinear.ts` → the only implementation in v1: `buildWritePoint` = `G29 W I{i} J{j} Z{z}`, `buildPersist` = `M500`, `buildEnable` = `M420 S{0|1}`
- **Why `G29 W` and not `M421`**: because the printer's own `M503` serializes its mesh as `G29 W I0 J0 Z0.16250` lines. Those lines are designed to be replayable — it is the write route the firmware itself declares.
- The UI never writes bilinear gcode directly: it consumes the interface. Adding `mbl.ts` / `ubl.ts` / `klipper.ts` later touches neither the UI nor the serial layer.

### 5.4 Session state machine
```
idle → connecting → preparing (preheat + home + G29 grid + M420 S0)
     → leveling (active point n of N)
     → review (all captured)
     → writing → verifying → done | mismatch
```
And per point: `pending` → `active` → `captured` (returning to `active` if the user navigates back to re-correct it).

## 6. UI — a single screen

```
┌──────────────────────────────────────────────────────────────┐
│  Level My Printer    [ Creality CR-10 Smart ▾ ]   ● Connected │  ← header
├──────────────────────────────────────────────────────────────┤
│                                                              │
│      ┌────────────────────────────────────────┐              │
│      │  ●    ●    ●    ●    ●                 │              │
│      │  ●    ●    ●    ●    ●                 │   300×300 bed │
│      │  ●    ●    ◉    ●    ●   ◉ = active    │   to scale    │
│      │  ✓    ✓    ✓    ✓    ✓   ✓ = captured  │              │
│      │  ✓    ✓    ✓    ✓    ✓                 │              │
│      └────────────────────────────────────────┘              │
│                     Point 13 of 25                           │
├──────────────────────────────────────────────────────────────┤
│  ← Previous    │   Z: -0.125 mm   │     Save    │      Next → │
│                │  [▲] [▼]  step: (0.01)(0.05)(0.1)           │  ← controls
└──────────────────────────────────────────────────────────────┘
```

### 6.1 Header
- **Printer select** — options from the registry (4). v1 shows only "Creality CR-10 Smart".
- **Connect / Disconnect** button + status indicator (connected, temperature, `M114`).
- The select is **locked while a session is running**; changing it asks for confirmation and resets.

### 6.2 Bed (centre)
- SVG of the bed **at real scale** from `profile.bed`, with the points at their true physical positions (not an abstract grid).
- Point visual states:
  - `pending` → hollow grey
  - `active` → blue, highlighted / pulsing ring
  - `captured` → **filled green**, with the captured Z value shown below it
- Progress label: "Point 13 of 25".
- Clicking a point jumps straight to it, in addition to Previous/Next.

### 6.3 Controls (bottom)
- **← Previous / Next →** — moves the head to the corresponding point (lifts to `zSafe`, travels in XY, descends to `zStart`). Navigating captures **nothing**.
- **▲ / ▼** — jogs Z by the active step. Sends **absolute** Z (`G1 Z{new} F{jog.feedrate}`), not relative: the value is explicit and accumulates no drift.
- **Step selector** — `0.01 / 0.05 / 0.1` mm (from the profile).
- **Save** — captures the current Z into local state, paints the point green and **advances on its own** to the next pending one. Nothing is written to the printer yet.
- Z reading always visible, with periodic verification against `M114` to catch desynchronization.

### 6.4 Final state (all 25 green)
The jog controls are replaced by:
- **Start over** — clears the capture and returns to point 1. **Does not touch the printer**: nothing has been written up to this point.
- **Save to printer** — opens the review (current vs. new mesh table + the exact command list, *dry run*), asks for explicit confirmation, and only then writes: 25 × `G29 W I J Z` + `M500`, replacing the whole mesh. Afterwards it verifies with `M503` and flags OK / mismatch per point.

## 7. Gcode sequence

**Preparation** (at session start)
```
M140 S60 / M104 S200 then M190 / M109   ; preheat FIRST (see 10.3: probing cold
                                        ; measures a different surface).
                                        ; Both requested before either is awaited,
                                        ; so they heat in parallel.
G28              ; home (with a load-cell probe, Z homes at the centre)
G29 L20 R280 F20 B280   ; pins the grid bounds → mapping known by construction.
                        ; Also leaves a fresh auto-level as the starting point
                        ; for manual correction.
                        ; NOTE: auto-saves to EEPROM (see 10.2)
M420 S0          ; disable compensation — CRITICAL, see note below
G90              ; absolute positioning
```

> **Fade height = 2 mm.** Compensation applies at 100% at Z=0 and fades out by 2 mm. Paper testing happens right in the zone of maximum compensation: without `M420 S0` you would measure the old mesh stacked on top of the new one. Not optional.

**Go to a point (i,j)** — used by Next, Previous and by Save's automatic advance
```
G1 Z{zSafe} F300            ; lift to travel height (F300 = 5 mm/s, the M203 Z ceiling)
G1 X{x} Y{y} F3000          ; travel
G1 Z{zStart} F300           ; descend to the starting Z (never straight to 0)
```

**Jog**
```
G1 Z{newZ} F{jogFeedrate}   ; absolute, clamped to the profile's [zMin, zMax]
```

**Save point** → local state only (`z`, `status: captured`) + "go to the next point".

**Final write**
```
G29 W I0 J0 Z{z00}
… × 25
M500                        ; persist to EEPROM
M503                        ; re-read and compare
M420 S1                     ; re-enable compensation
G28
```

**Design note (decision taken, worth revisiting against hardware):** the traversal is driven by the app (`G1` + local capture + final batch), **not** by Marlin's native wizard (`G29 S1` / `G29 S2`). Reason: "Start over" then costs nothing and never leaves the printer half-configured, and "Save to printer" is a single atomic, reviewable act. If the native flow proves more reliable in testing, `LevelingStrategy` is the place to encapsulate that variant without touching the UI.

## 8. Safety guardrails
- **Hard Z clamp** to the profile's `[safety.zMin, safety.zMax]`; double confirmation to go past `zMin`
- Never lower Z without having lifted to `zSafe` and completed the XY travel (avoid dragging the nozzle across the glass)
- Explicit confirmation before: homing, writing EEPROM, switching printers with an active session
- Timeout in the command queue; if no `ok` arrives within N seconds, abort and report
- Persistent "do not unplug the USB / do not close the tab" warning while the 25 points are being written
- Mandatory **dry run** before the final batch: show the exact command list
- If the tab reloads mid-session, offer to resume from `localStorage` (or discard)

## 9. Out of scope (v1)
- Multiple simultaneous printers
- Sending/managing print G-code files (this is a calibration tool, not an OctoPrint-style host)
- WiFi/network connection — USB serial only
- Any cloud persistence
- Other leveling systems (MBL, UBL, Klipper) — **not implemented, but `LevelingStrategy` (5.3) leaves the extension point ready**
- Other printers — **not implemented, but the registry (4) leaves the extension point ready**

## 10. Risks and open questions

### 10.1 ~~RISK #1~~ — index ↔ mm mapping: **RESOLVED**
The app needs both halves: moving the nozzle to a point (`G1 X.. Y..`, in mm) and storing the value at the right index (`G29 W I.. J..`). If the mapping were wrong, every measurement would be filed in the wrong place, **with no error and no warning**, leaving a mesh worse than the one you started with.

**Solution: don't discover the bounds, dictate them.** Verified against the hardware — Creality's firmware accepts `G29 L R F B` (tested with `G29 L100 R200 F100 B200`: probing confined itself to a central square while staying 5×5). So:

```
spacing_x = (R - L) / (cols - 1)      x(i) = L + i * spacing_x
spacing_y = (B - F) / (rows - 1)      y(j) = F + j * spacing_y
```

`GRID_MAX_POINTS` (5×5) is a compile-time constant and does not change; only the bounds are controllable. The app opens every session with `G29 L20 R280 F20 B280` → points at X and Y = **20, 85, 150, 215, 280**. Plain arithmetic, dependent on no Creality constant nor on their `Configuration.h`.

Discarded routes, so nobody retries them:
- **`M111 S32` + `G29` (debug)**: `DEBUG_LEVELING_FEATURE` is not compiled in. `echo:DEBUG:` returned an empty list.
- **`G29 S1`/`S2` (MBL wizard)**: MBL syntax, does not apply to bilinear.
- **`Configuration.h`**: under bilinear the bounds live in EEPROM (`bilinear_start`, `bilinear_grid_spacing`) and are set by the last `G29`. They are state, not configuration.

### 10.2 This firmware's `G29` auto-saves to EEPROM
`G29` ends with `echo:Settings Stored` without being asked. Consequences:
- **`M501` is not an "undo"** — it reloads the mesh just probed, not the previous one.
- The only real backup of the prior mesh is the 25 `G29 W` lines from `M503`, stored in the `.capture.txt`.
- **Restoring values does not restore bounds**: replaying the `G29 W` lines brings back the numbers but not `bilinear_start`/`bilinear_grid_spacing`. If a `G29 L R F B` left odd bounds, a plain `G29` is needed to return to the default.
- The app has to warn about this before any operation that triggers a `G29`, and offer to export the current mesh as a backup first.

### 10.3 Probe repeatability: ~0.1 mm between runs
Two `G29` runs on the same bed produced meshes with the **same shape** but offset: mean +0.073 mm, range +0.033 to +0.139. Both cold (~24 °C).

Design implications:
- **Preheating before measuring is not optional.** The bed deforms as it heats; probing cold measures a different surface.
- The nozzle is the probe (load cell): **it has to be clean**. A speck of filament skews the whole mesh.
- What the app captures well is the bed's **shape**. The absolute zero is set by `G28` + `M851` + babystepping, and varies between runs — better not to promise absolute precision the hardware does not deliver.
- This spread is precisely what a manual paper check catches and automatic probing does not. It is the product's argument.

### 10.4 Others
- **Bed orientation on screen**: bed Y grows toward the back; SVG Y grows downward. Flip it, and validate by moving to a corner point and confirming visually.
- **Marlin timing over USB**: the board's buffer is small; the queue must await the real `ok`, never assume it.
- **A single port consumer**: Web Serial allows one active *reader* — mind the open/close cycle.
- **Port authorization**: the first time, the device has to be picked from the browser dialog. Chrome remembers the grant per origin, so `navigator.serial.getPorts()` allows reconnecting without asking again — implemented in `SerialConnection.getAuthorizedPorts()`.
- **The printer can already auto-level** (`Cap:AUTOLEVEL:1`, coaxial probe). This app's value is not replacing the automatic `G29` but **correcting it by hand**, which is a real use case but worth stating plainly: if the factory mesh is already good, the manual flow is fine-tuning, not leveling from scratch.

## 11. Development phases
- **Phase 0** — ✅ **DONE**. Vite+React+TS setup, serial connection, command queue, raw terminal for debugging
- **Phase 1** — ✅ **DONE**. Printer registry + header select + `meshGeometry` + **SVG bed to scale with the 25 points** (no printer connected: mock mode)
- **Phase 2** — ✅ **DONE**. Navigation between points (Previous/Next) with real movement + Z jog + clamps
- **Phase 3** — ✅ **DONE**. Point capture ("Save" → green → automatic advance) + progress + session persistence
- **Phase 4** — ✅ **DONE**. Review screen + batch write + `M500` + verification via `M503` + Start over
- **Phase 5** — Guardrails, error handling, preheating, UX polish

## 12. Folder structure
```
src/
  serial/
    connect.ts
    protocol.ts
    commandQueue.ts
  printers/
    types.ts                          (PrinterProfile)
    registry.ts
    creality-cr10-smart.ts            (the only profile in v1)
    creality-cr10-smart.capture.txt   (evidence: raw firmware output)
  printer/
    types.ts
    meshGeometry.ts
    gcodeBuilders.ts
    leveling/
      types.ts               (LevelingStrategy interface)
      bilinear.ts            (the only implementation in v1)
      # mbl.ts, ubl.ts, klipper.ts → future
  features/
    header/Header.tsx        (printer select + status + connect)
    connect/BrowserCheck.tsx (Web Serial support / secure context)
    bed/BedView.tsx          (SVG to scale, points grey / blue / green)
    controls/LevelingControls.tsx  (Previous / Next / ▲▼ / step / Save)
    leveling/
      sequences.ts           (gcode sequences, pure)
      useLeveling.ts         (binds the session to the printer)
    review/MeshReview.tsx    (diff table + dry run + verification)
    terminal/Terminal.tsx    (raw gcode console, debug)
  state/
    printerStore.ts
    levelingSession.ts
  App.tsx
  main.tsx
```
