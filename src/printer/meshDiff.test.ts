import { describe, expect, it } from 'vitest'
import type { MeshPoint } from './types.ts'
import { allVerified, diffMesh, verifyWrite } from './meshDiff.ts'

const point = (i: number, j: number, z: number): MeshPoint => ({
  i,
  j,
  z,
  pos: { x: NaN, y: NaN },
})

// Real values from the CR-10 Smart capture.
const CURRENT: MeshPoint[] = [point(0, 0, 0.1625), point(1, 0, 0.064), point(2, 0, -0.117)]

describe('diffMesh', () => {
  it('pairs each captured point with what the printer holds today', () => {
    const rows = diffMesh(CURRENT, [{ i: 0, j: 0, z: 0.2 }])
    expect(rows[0]).toEqual({ i: 0, j: 0, current: 0.1625, next: 0.2, delta: 0.2 - 0.1625 })
  })

  it('skips points that were never captured', () => {
    const rows = diffMesh(CURRENT, [
      { i: 0, j: 0, z: 0.2 },
      { i: 1, j: 0, z: null },
    ])
    expect(rows).toHaveLength(1)
  })

  it('still lists a point with no baseline to compare against', () => {
    // Happens when M503 could not be read: we can show what will be written,
    // just not what it replaces. Better than hiding the row.
    const rows = diffMesh([], [{ i: 3, j: 3, z: -0.05 }])
    expect(rows[0]).toMatchObject({ current: null, delta: null, next: -0.05 })
  })
})

describe('verifyWrite', () => {
  it('accepts values that came back as written', () => {
    const rows = verifyWrite([{ i: 0, j: 0, z: 0.125 }], [point(0, 0, 0.125)])
    expect(rows[0]?.ok).toBe(true)
    expect(allVerified(rows)).toBe(true)
  })

  it('tolerates float32 rounding but not a real difference', () => {
    // The firmware reports 5 decimals for a value written with 3.
    expect(verifyWrite([{ i: 0, j: 0, z: 0.125 }], [point(0, 0, 0.12502)])[0]?.ok).toBe(true)
    expect(verifyWrite([{ i: 0, j: 0, z: 0.125 }], [point(0, 0, 0.126)])[0]?.ok).toBe(false)
  })

  it('flags a point the printer never reported back', () => {
    const rows = verifyWrite([{ i: 4, j: 4, z: -0.1 }], [])
    expect(rows[0]).toMatchObject({ actual: null, ok: false })
    expect(allVerified(rows)).toBe(false)
  })

  it('does not call an empty verification a success', () => {
    // Otherwise "wrote nothing" would report as "everything verified".
    expect(allVerified([])).toBe(false)
  })
})
