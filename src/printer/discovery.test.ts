import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { CR10_SMART } from '../printers/creality-cr10-smart.ts'
import { detectPrinter, meshDimensions, profileMismatches } from './discovery.ts'

/**
 * The real thing, not a fixture: the profile was hand-derived from this file,
 * so detection reading it back is the check that the two agree.
 */
const CAPTURE = readFileSync(
  new URL('../printers/creality-cr10-smart.capture.txt', import.meta.url),
  'utf8',
)

describe('detecting a printer from its own replies', () => {
  const detected = detectPrinter(CAPTURE)

  it('reads the machine and firmware out of M115', () => {
    expect(detected.machine).toBe('CR-10 Smart')
    expect(detected.firmware).toBe('1.0.14')
  })

  it('reads the capability flags', () => {
    expect(detected.capabilities.AUTOLEVEL).toBe(true)
    expect(detected.capabilities.LEVELING_DATA).toBe(true)
    expect(detected.capabilities.EEPROM).toBe(true)
    expect(detected.capabilities.WIFI).toBe(false)
  })

  it('reads the UUID, which identifies the machine and not the model', () => {
    expect(detected.uuid).toBe('cede2a2f-41a2-4748-9b12-c55c62f367ff')
  })

  it('names the leveling system from the command M503 replays', () => {
    expect(detected.leveling).toBe('bilinear')
  })

  it('counts the grid from the mesh, with no model knowledge', () => {
    // The highest index the firmware reports *is* the grid.
    expect(detected.mesh).toEqual({ cols: 5, rows: 5 })
  })

  it('reads the travel envelope from M211', () => {
    expect(detected.travel?.min).toEqual({ x: -2, y: -10, z: 0 })
    expect(detected.travel?.max).toEqual({ x: 305, y: 305, z: 405 })
  })

  it('derives the Z resolution from M92', () => {
    // M92 Z400 -> one full step is 1/400 mm.
    expect(detected.zResolution).toBeCloseTo(0.0025, 10)
  })

  it('converts the M203 Z ceiling to mm/min', () => {
    // M203 reports units/s; the rest of the app speaks mm/min.
    expect(detected.maxFeedrateZ).toBe(300)
  })

  it('agrees with the profile that was hand-derived from this capture', () => {
    // If this ever fails, one of the two drifted from the evidence.
    expect(profileMismatches(CR10_SMART, detected)).toEqual([])
  })
})

describe('catching a profile that does not fit the machine', () => {
  const detected = detectPrinter(CAPTURE)

  it('flags a grid of the wrong size', () => {
    // The dangerous one: the app would draw points that do not exist and write
    // measurements to indices the firmware refuses.
    const wrong = { ...CR10_SMART, mesh: { ...CR10_SMART.mesh, cols: 3, rows: 3 } }
    expect(profileMismatches(wrong, detected)[0]).toContain('5×5')
  })

  it('flags a bed drawn larger than the machine can reach', () => {
    const wrong = { ...CR10_SMART, bed: { width: 400, depth: 400 } }
    expect(profileMismatches(wrong, detected)[0]).toContain('travel stops')
  })

  it('flags Z moves above the firmware ceiling', () => {
    const wrong = { ...CR10_SMART, feedrates: { ...CR10_SMART.feedrates, travelZ: 600 } }
    expect(profileMismatches(wrong, detected)[0]).toContain('ceiling')
  })

  it('flags a jog step finer than the machine can move', () => {
    const wrong = { ...CR10_SMART, jog: { ...CR10_SMART.jog, steps: [0.001, 0.01] } }
    expect(profileMismatches(wrong, detected)[0]).toContain('resolves')
  })
})

describe('telling the leveling systems apart', () => {
  it('recognises UBL by its own write command', () => {
    expect(detectPrinter('echo:  M421 I0 J0 Z0.10000').leveling).toBe('ubl')
  })

  it('recognises MBL', () => {
    expect(detectPrinter('echo:  G29 S3 X0 Y0 Z0.10000').leveling).toBe('mbl')
  })

  it('falls back to the M420 header when no points are stored', () => {
    expect(detectPrinter('Bilinear Leveling Grid:').leveling).toBe('bilinear')
  })

  it('says nothing rather than guessing', () => {
    // Guessing here means writing G29 W at a firmware expecting M421.
    expect(detectPrinter('ok').leveling).toBeNull()
  })
})

describe('degrading on a silent or partial printer', () => {
  it('returns nulls rather than guessing', () => {
    const detected = detectPrinter('ok\nok\n')
    expect(detected.machine).toBeNull()
    expect(detected.mesh).toBeNull()
    expect(detected.travel).toBeNull()
    expect(detected.zResolution).toBeNull()
  })

  it('reports nothing to worry about when there is nothing to compare', () => {
    expect(profileMismatches(CR10_SMART, detectPrinter(''))).toEqual([])
  })

  it('has no dimensions for an empty mesh', () => {
    expect(meshDimensions([])).toBeNull()
  })
})

describe('the point list the firmware hands over', () => {
  it('takes the points from the G29 W lines, not from the grid size', () => {
    const detected = detectPrinter(
      [
        'echo:  G29 W I0 J0 Z0.16250',
        'echo:  G29 W I1 J0 Z0.06400',
        'echo:  G29 W I0 J1 Z0.15550',
        'echo:  G29 W I1 J1 Z0.10000',
      ].join('\n'),
    )

    expect(detected.meshPoints).toEqual([
      { i: 0, j: 0 },
      { i: 1, j: 0 },
      { i: 0, j: 1 },
      { i: 1, j: 1 },
    ])
    expect(detected.mesh).toEqual({ cols: 2, rows: 2 })
  })

  it('reports no points at all for a printer that has never been probed', () => {
    // An unprobed bilinear grid serialises nothing. Counting it as a 0×0 grid
    // would be a fact invented out of silence.
    const detected = detectPrinter('FIRMWARE_NAME:Marlin 2.0.8.1 MACHINE_TYPE:CR-10 Smart')

    expect(detected.meshPoints).toEqual([])
    expect(detected.mesh).toBeNull()
  })
})
