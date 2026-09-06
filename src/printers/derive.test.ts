import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectPrinter } from '../printer/discovery.ts'
import { CR10_SMART } from './creality-cr10-smart.ts'
import { deriveProfile, findKnownProfile, probeableBounds } from './derive.ts'

const CAPTURE = readFileSync(new URL('./creality-cr10-smart.capture.txt', import.meta.url), 'utf8')
const DETECTED = detectPrinter(CAPTURE)

/** A machine that answers nothing, to check each field falls back on its own. */
const SILENT = detectPrinter('FIRMWARE_NAME:x MACHINE_TYPE:Nobody')

describe('adopting what the printer said', () => {
  const profile = deriveProfile(DETECTED, 115200, CR10_SMART)

  it('takes its name and the rate that actually worked', () => {
    expect(profile.label).toBe('CR-10 Smart')
    expect(profile.baudRate).toBe(115200)
  })

  it('keeps a matched profile id, so saved work still points at it', () => {
    expect(profile.id).toBe(CR10_SMART.id)
  })

  it('takes the grid, the limits and the leveling system from the machine', () => {
    expect(profile.mesh.cols).toBe(5)
    expect(profile.mesh.rows).toBe(5)
    expect(profile.travel.max).toEqual({ x: 305, y: 305, z: 405 })
    expect(profile.leveling).toBe('bilinear')
    expect(profile.fadeHeight).toBe(2)
  })

  it('reads the preheat presets out of M145', () => {
    expect(profile.preheat).toEqual({ nozzle: 200, bed: 60 })
  })

  it('never sends Z faster than M203 allows', () => {
    // Marlin would clamp anyway, but sending more hides the mistake.
    expect(profile.feedrates.travelZ).toBeLessThanOrEqual(300)
  })

  it('starts a known profile from its hand-written bounds', () => {
    // Grid bounds in mm cannot be read from any command (PLAN.md 10.1). These
    // are a better starting point than an inset guess, but they are still only
    // a proposal: nothing is drawn on the bed until a pin record says this
    // machine really has them.
    expect(profile.mesh.min).toEqual(CR10_SMART.mesh.min)
    expect(profile.mesh.max).toEqual(CR10_SMART.mesh.max)
  })
})

describe('a machine nobody wrote a profile for', () => {
  const unknown = { ...DETECTED, machine: 'Some Other Printer', uuid: 'uuid-1' }
  const profile = deriveProfile(unknown, 250000, CR10_SMART)

  it('still works, from its own answers', () => {
    expect(profile.label).toBe('Some Other Printer')
    expect(profile.mesh.cols).toBe(5)
    expect(profile.bed).toEqual({ width: 305, depth: 305 })
  })

  it('gets an id of its own so its work is not filed under another machine', () => {
    expect(profile.id).toBe('uuid-1')
  })

  it('insets the grid bounds within the probeable area', () => {
    expect(profile.mesh.min).toEqual({ x: 20, y: 20 })
    expect(profile.mesh.max).toEqual({ x: 285, y: 285 })
  })
})

describe('a firmware that answers almost nothing', () => {
  const profile = deriveProfile(SILENT, 115200, CR10_SMART)

  it('falls back field by field, not all at once', () => {
    expect(profile.label).toBe('Nobody')
    expect(profile.travel).toEqual(CR10_SMART.travel)
    expect(profile.mesh.cols).toBe(CR10_SMART.mesh.cols)
    expect(profile.feedrates).toEqual(CR10_SMART.feedrates)
    expect(profile.preheat).toEqual(CR10_SMART.preheat)
  })

  it('does not match a profile by a name it does not have', () => {
    expect(findKnownProfile(SILENT)).toBeUndefined()
  })
})

describe('working out where the grid can go', () => {
  const travel = CR10_SMART.travel

  it('keeps a margin off the bed edges', () => {
    const { min, max } = probeableBounds({ width: 300, depth: 300 }, travel, null, 20)
    expect(min).toEqual({ x: 20, y: 20 })
    expect(max).toEqual({ x: 280, y: 280 })
  })

  it('shifts with the probe offset, because the nozzle is what is constrained', () => {
    // To put the probe at a bed coordinate the nozzle sits an offset away, and
    // the soft endstops constrain the nozzle.
    const { min } = probeableBounds({ width: 300, depth: 300 }, travel, { x: 40, y: 0 }, 20)
    expect(min.x).toBe(38) // travel.min.x (-2) + offset (40)
  })

  it('never lets a wide offset push the grid past the sheet', () => {
    const { max } = probeableBounds({ width: 300, depth: 300 }, travel, { x: -60, y: 0 }, 20)
    expect(max.x).toBe(245) // travel.max.x (305) - 60, still short of 280
  })
})
