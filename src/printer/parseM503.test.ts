import { describe, expect, it } from 'vitest'
import { findMeshPoint, parseM503 } from './parseM503.ts'

// Verbatim excerpt from creality-cr10-smart.capture.txt.
const REAL_DUMP = `echo:; Steps per unit:
echo: M92 X80.00 Y80.00 Z400.00 E102.80
echo:; Auto Bed Leveling:
echo:  M420 S1 Z2.00
echo:  G29 W I0 J0 Z0.16250
echo:  G29 W I1 J0 Z0.06400
echo:  G29 W I2 J0 Z-0.11700
echo:  G29 W I4 J4 Z-0.16450
echo:; Z-Probe Offset (mm):
echo:  M851 X0 Y0 Z0.31
ok`

describe('parseM503', () => {
  const settings = parseM503(REAL_DUMP)

  it('extracts the mesh points the firmware lists', () => {
    expect(settings.mesh).toHaveLength(4)
    expect(findMeshPoint(settings.mesh, 0, 0)?.z).toBe(0.1625)
    expect(findMeshPoint(settings.mesh, 4, 4)?.z).toBe(-0.1645)
  })

  it('reads negative Z values', () => {
    expect(findMeshPoint(settings.mesh, 2, 0)?.z).toBe(-0.117)
  })

  it('reads leveling state and fade height', () => {
    expect(settings.leveling).toEqual({ enabled: true, fadeHeight: 2 })
  })

  it('reads the probe offset', () => {
    expect(settings.probeOffset).toEqual({ x: 0, y: 0, z: 0.31 })
  })

  it('leaves physical positions unset', () => {
    // M503 reports indices only. The index→mm mapping belongs to the profile;
    // inventing coordinates here would be the exact bug PLAN.md 10.1 is about.
    expect(settings.mesh[0]?.pos.x).toBeNaN()
  })

  it('survives a dump with no mesh', () => {
    expect(parseM503('echo:  M92 X80.00\nok').mesh).toEqual([])
  })

  it('handles M420 with no fade height', () => {
    expect(parseM503('echo:  M420 S0').leveling).toEqual({ enabled: false, fadeHeight: 0 })
  })
})
