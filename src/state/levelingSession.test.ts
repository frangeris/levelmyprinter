import { beforeEach, describe, expect, it } from 'vitest'
import { CR10_SMART } from '../printers/creality-cr10-smart.ts'
import {
  capturedCount,
  isComplete,
  measuredCount,
  pointStatus,
  useLevelingSession,
} from './levelingSession.ts'

const session = () => useLevelingSession.getState()

beforeEach(() => {
  useLevelingSession.getState().start(CR10_SMART)
})

describe('leveling session', () => {
  it('starts with all 25 points uncaptured', () => {
    expect(session().points).toHaveLength(25)
    expect(capturedCount(session().points)).toBe(0)
    expect(isComplete(session().points)).toBe(false)
  })

  it('stores the active point Z and advances on its own', () => {
    session().nudge(CR10_SMART, -1)
    const z = session().zTarget
    session().capture()

    expect(session().points[0]?.z).toBe(z)
    expect(session().currentIndex).toBe(1)
  })

  it('restores a captured point value when going back to it', () => {
    session().nudge(CR10_SMART, -1)
    session().capture()

    session().goTo(0)
    expect(session().zTarget).toBe(session().points[0]?.z)
  })

  it('jumps to what is still missing after fixing an old point, not to the next one', () => {
    // Capturing the first three leaves the active point at index 3.
    session().capture()
    session().capture()
    session().capture()
    expect(session().currentIndex).toBe(3)

    // Go back to fix point 0 and save it: 1 and 2 are already done, so the real
    // next pending one is 3.
    session().goTo(0)
    session().capture()
    expect(session().currentIndex).toBe(3)
  })

  it('completes the session without getting stuck on the last point', () => {
    for (let i = 0; i < 25; i++) session().capture()

    expect(isComplete(session().points)).toBe(true)
    expect(capturedCount(session().points)).toBe(25)
  })

  it('keeps a loaded value that is not on the step grid', () => {
    // The touch-up pass exists to adjust what the printer already holds, and
    // its values are floats from the probe — 0.132 is not a multiple of any
    // jog step. Snapping to the grid would move 0.012 and lose the 0.002.
    session().restore(
      session().points.map((_, index) => ({
        z: index === 0 ? 0.132 : null,
        source: index === 0 ? ('printer' as const) : null,
      })),
    )
    session().setStep(0.01)
    session().nudge(CR10_SMART, -1)

    expect(session().zTarget).toBe(0.122)
  })

  it('does not accumulate float error over many jogs', () => {
    session().setStep(0.01)
    for (let i = 0; i < 20; i++) session().nudge(CR10_SMART, 1)

    // Without snapping this would land on 0.19999999999999998.
    expect(session().zTarget).toBe(0.2)
  })

  it('goes straight to a typed Z, on or off the step grid', () => {
    // 0.154 -> 0.155 is not reachable by nudging with any of the jog steps.
    session().setZ(CR10_SMART, 0.155)
    expect(session().zTarget).toBe(0.155)

    session().setZ(CR10_SMART, 0.1543)
    expect(session().zTarget).toBe(0.1543)
  })

  it('clamps a typed Z against the safety floor and ceiling', () => {
    session().setZ(CR10_SMART, -50)
    expect(session().zTarget).toBe(CR10_SMART.safety.zMin)

    session().setZ(CR10_SMART, 9999)
    expect(session().zTarget).toBe(CR10_SMART.safety.zMax)
  })

  it('refuses to go below the safety floor', () => {
    session().setStep(0.1)
    for (let i = 0; i < 100; i++) session().nudge(CR10_SMART, -1)

    expect(session().zTarget).toBe(CR10_SMART.safety.zMin)
  })

  it('starting over clears the captures and returns to the first point', () => {
    session().capture()
    session().capture()
    session().reset()

    expect(capturedCount(session().points)).toBe(0)
    expect(session().currentIndex).toBe(0)
  })

  it('classifies points as pending / active / captured', () => {
    session().capture()
    const { points, currentIndex } = session()

    expect(pointStatus(points[0]!, 0, currentIndex)).toBe('captured')
    expect(pointStatus(points[1]!, 1, currentIndex)).toBe('active')
    expect(pointStatus(points[2]!, 2, currentIndex)).toBe('pending')
  })
})

describe('loading the printer mesh', () => {
  /** What M503 gives back: grid indices and a Z, in the firmware's own order. */
  const dump = (count: number) =>
    Array.from({ length: count }, (_, n) => ({
      i: n % 5,
      j: Math.floor(n / 5),
      z: Number((n * 0.01 - 0.1).toFixed(3)),
    }))

  it('fills every point and marks where the values came from', () => {
    const loaded = session().loadFromPrinter(dump(25))

    expect(loaded).toBe(25)
    expect(isComplete(session().points)).toBe(true)
    // Filled, but not measured: nobody has checked any of these by hand.
    expect(measuredCount(session().points)).toBe(0)
  })

  it('matches by grid index, not by traversal order', () => {
    // Row 1 is walked right-to-left, so the sixth point of the session is I4 J1
    // while the sixth line of the dump is I0 J1. Reading them positionally
    // would mirror every odd row.
    session().loadFromPrinter(dump(25))

    const point = session().points[5]!
    expect([point.i, point.j]).toEqual([4, 1])
    expect(point.z).toBe(dump(25).find((e) => e.i === 4 && e.j === 1)!.z)
  })

  it('leaves points the printer did not report uncaptured', () => {
    // A zero here would be indistinguishable from a measurement of zero, and it
    // would get written to the machine.
    const loaded = session().loadFromPrinter([{ i: 0, j: 0, z: -0.05 }])

    expect(loaded).toBe(1)
    expect(session().points[0]?.z).toBe(-0.05)
    expect(session().points[1]?.z).toBeNull()
    expect(session().points[1]?.source).toBeNull()
  })

  it('starts the pass at the first point, showing its loaded value', () => {
    session().loadFromPrinter(dump(25))

    expect(session().currentIndex).toBe(0)
    expect(session().zTarget).toBe(session().points[0]?.z)
  })

  it('turns a point into a measurement once it is saved by hand', () => {
    session().loadFromPrinter(dump(25))
    session().goTo(7)
    session().nudge(CR10_SMART, 1)
    const adjusted = session().zTarget
    session().capture()

    const point = session().points[7]!
    expect(point.z).toBe(adjusted)
    expect(point.source).toBe('measured')
    expect(measuredCount(session().points)).toBe(1)
  })

  it('stays put when saving into an already-complete grid', () => {
    // Nothing is pending, so there is nowhere to advance to. Jumping back to
    // point 0 mid-touch-up would be worse than standing still.
    session().loadFromPrinter(dump(25))
    session().goTo(11)
    session().capture()

    expect(session().currentIndex).toBe(11)
    expect(capturedCount(session().points)).toBe(25)
  })

  it('starting over clears the loaded values too', () => {
    session().loadFromPrinter(dump(25))
    session().reset()

    expect(capturedCount(session().points)).toBe(0)
    expect(session().points.every((point) => point.source === null)).toBe(true)
  })
})

describe('restoring a saved grid', () => {
  const values = Array.from({ length: 25 }, (_, n) => ({
    z: n * 0.01 - 0.1,
    source: (n % 2 === 0 ? 'measured' : 'printer') as 'measured' | 'printer',
  }))

  it('puts the values and their provenance back', () => {
    session().restore(values)

    expect(session().points[0]?.z).toBe(values[0]!.z)
    expect(session().points[0]?.source).toBe('measured')
    expect(session().points[1]?.source).toBe('printer')
    expect(measuredCount(session().points)).toBe(13)
  })

  it('starts at the first point, showing its restored value', () => {
    session().goTo(9)
    session().restore(values)

    expect(session().currentIndex).toBe(0)
    expect(session().zTarget).toBe(values[0]!.z)
  })

  it('refuses a list of the wrong length instead of half-applying it', () => {
    // Positional: a short list would shift every value onto a neighbouring
    // point, and those get written to the machine.
    session().capture()
    const before = session().points.map((point) => point.z)

    session().restore(values.slice(0, 10))
    expect(session().points.map((point) => point.z)).toEqual(before)
  })
})

describe('saving a point that reads zero', () => {
  it('captures 0 as a value, not as an empty slot', () => {
    // A bed that is level at this point measures 0.000. Treating that as "not
    // captured" would leave the pass unable to finish on a good bed.
    session().setZ(CR10_SMART, 0)
    session().capture()

    const point = session().points[0]!
    expect(point.z).toBe(0)
    expect(point.source).toBe('measured')
    expect(capturedCount(session().points)).toBe(1)
  })

  it('turns a printer zero into a measurement when it is saved by hand', () => {
    // The touch-up flow: an unprobed grid loads as 25 zeros, and walking them
    // one by one is how they stop being the printer's word and become yours.
    session().loadFromPrinter(
      Array.from({ length: 25 }, (_, n) => ({ i: n % 5, j: Math.floor(n / 5), z: 0 })),
    )
    expect(measuredCount(session().points)).toBe(0)

    session().capture()

    expect(session().points[0]?.source).toBe('measured')
    expect(measuredCount(session().points)).toBe(1)
  })
})
