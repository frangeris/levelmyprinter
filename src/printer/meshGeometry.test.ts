import { describe, expect, it } from 'vitest'
import { CR10_SMART } from '../printers/creality-cr10-smart.ts'
import { bedToScreen, buildMeshPoints, meshPointPosition, meshSpacing } from './meshGeometry.ts'

describe('meshGeometry', () => {
  it('spreads the 5 points across the bounds the app pins', () => {
    // G29 L20 R280 F20 B280 over a 5x5 grid → 65 mm spacing.
    expect(meshSpacing(CR10_SMART)).toEqual({ x: 65, y: 65 })

    const xs = [0, 1, 2, 3, 4].map((i) => meshPointPosition(CR10_SMART, i, 0).x)
    expect(xs).toEqual([20, 85, 150, 215, 280])
  })

  it('puts the middle point at the centre of the bed', () => {
    // The grid is symmetric because M851 X0 Y0: the probe does not offset it.
    expect(meshPointPosition(CR10_SMART, 2, 2)).toEqual({ x: 150, y: 150 })
  })

  it('traverses in serpentine, alternating each row direction', () => {
    const points = buildMeshPoints(CR10_SMART)
    expect(points).toHaveLength(25)

    expect(points.slice(0, 5).map((p) => p.i)).toEqual([0, 1, 2, 3, 4])
    expect(points.slice(5, 10).map((p) => p.i)).toEqual([4, 3, 2, 1, 0])
    expect(points.slice(0, 5).every((p) => p.j === 0)).toBe(true)
    expect(points.slice(5, 10).every((p) => p.j === 1)).toBe(true)
  })

  it('neither repeats nor skips any grid index', () => {
    const keys = buildMeshPoints(CR10_SMART).map((p) => `${p.i},${p.j}`)
    expect(new Set(keys).size).toBe(25)
  })

  it('flips Y when converting to screen space', () => {
    // Y=0 is the front of the bed, but in SVG the front belongs at the bottom.
    expect(bedToScreen(CR10_SMART, { x: 0, y: 0 }, 300, 300)).toEqual({ x: 0, y: 300 })
    expect(bedToScreen(CR10_SMART, { x: 300, y: 300 }, 300, 300)).toEqual({ x: 300, y: 0 })
    expect(bedToScreen(CR10_SMART, { x: 150, y: 150 }, 300, 300)).toEqual({ x: 150, y: 150 })
  })
})

describe('walking the points the printer listed', () => {
  /** What M503 hands over: one `G29 W I.. J..` per point, row by row. */
  const reported = Array.from({ length: 25 }, (_, n) => ({ i: n % 5, j: Math.floor(n / 5) }))

  it('walks the reported list rather than a grid it worked out', () => {
    const profile = { ...CR10_SMART, mesh: { ...CR10_SMART.mesh, points: reported } }
    expect(buildMeshPoints(profile)).toEqual(buildMeshPoints(CR10_SMART))
  })

  it('keeps our own serpentine order, not the order M503 printed', () => {
    // The firmware lists row-major; the app visits serpentine because that is
    // what keeps the head from crossing the bed between neighbours.
    const profile = { ...CR10_SMART, mesh: { ...CR10_SMART.mesh, points: reported } }
    const walked = buildMeshPoints(profile)

    expect([walked[0]!.i, walked[0]!.j]).toEqual([0, 0])
    expect([walked[5]!.i, walked[5]!.j]).toEqual([4, 1])
  })

  it('enumerates only what was reported, without filling in the rectangle', () => {
    // A firmware that lists fewer points than its bounding box gets those
    // points and no others: inventing the missing ones would put a dot on the
    // bed that the machine has no index for.
    const profile = {
      ...CR10_SMART,
      mesh: {
        ...CR10_SMART.mesh,
        points: [
          { i: 0, j: 0 },
          { i: 4, j: 4 },
        ],
      },
    }

    expect(buildMeshPoints(profile)).toHaveLength(2)
  })

  it('falls back to cols × rows for a profile with nothing detected', () => {
    expect(buildMeshPoints(CR10_SMART)).toHaveLength(25)
  })
})
