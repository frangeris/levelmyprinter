import type { PrinterProfile } from './types.ts'

/**
 * Creality CR-10 Smart.
 *
 * Derived from `creality-cr10-smart.capture.txt` (firmware 1.0.14, HW CRC2405V1.2).
 * Every value carries its source. After a firmware update: capture again, diff
 * it, and adjust here.
 */
export const CR10_SMART: PrinterProfile = {
  id: 'creality-cr10-smart',
  label: 'Creality CR-10 Smart',
  machineType: 'CR-10 Smart',
  baudRate: 115200,

  bed: { width: 300, depth: 300 },

  // M211: Min X-2.00 Y-10.00 Z0.00  Max X305.00 Y305.00 Z405.00
  travel: {
    min: { x: -2, y: -10, z: 0 },
    max: { x: 305, y: 305, z: 405 },
  },

  mesh: {
    // M503 reports I0..I4 / J0..J4. GRID_MAX_POINTS is a compile-time constant.
    cols: 5,
    rows: 5,
    // Chosen by the app, not read from the firmware: imposed with
    // `G29 L20 R280 F20 B280`. Resulting points: 20, 85, 150, 215, 280.
    min: { x: 20, y: 20 },
    max: { x: 280, y: 280 },
    order: 'serpentine',
  },

  // M420 V1 → "Bilinear Leveling Grid"
  leveling: 'bilinear',

  // M420 S1 Z2.00
  fadeHeight: 2.0,

  jog: {
    // M92 Z400 → 0.0025 mm resolution; 0.01 is 4 microsteps.
    steps: [0.01, 0.05, 0.1],
    feedrate: 120,
  },

  feedrates: {
    // M203 X500 Y500 (mm/s) → 3000 mm/min leaves plenty of headroom.
    travelXY: 3000,
    // M203 Z5.00 mm/s = 300 mm/min. That is the ceiling, do not exceed it.
    travelZ: 300,
  },

  safety: {
    zSafe: 5,
    zStart: 0.2,
    zMin: -2,
    zMax: 405,
  },

  // M145 S0 H200 B60
  preheat: { nozzle: 200, bed: 60 },
}
