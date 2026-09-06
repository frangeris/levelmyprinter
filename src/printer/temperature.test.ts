import { describe, expect, it } from 'vitest'
import { coldHeaters, isAtTemperature } from './temperature.ts'

describe('at temperature', () => {
  const hot = { nozzle: { current: 149.2, target: 150 }, bed: { current: 59.1, target: 60 } }

  it('is not at temperature when the printer has said nothing', () => {
    // Unknown is not hot. Treating silence as a pass would let the gate open on
    // a machine that never answered.
    expect(isAtTemperature(null)).toBe(false)
    expect(coldHeaters(null)).toEqual(['nozzle', 'bed'])
  })

  it('is at temperature once both heaters have arrived', () => {
    expect(isAtTemperature(hot)).toBe(true)
    expect(coldHeaters(hot)).toEqual([])
  })

  it('tolerates the swing of a bed holding its setpoint', () => {
    // PID overshoots and undershoots for as long as the bed is on. Within a few
    // degrees it is still a heated bed.
    expect(isAtTemperature({ ...hot, bed: { current: 56.4, target: 60 } })).toBe(true)
    expect(isAtTemperature({ ...hot, bed: { current: 63.8, target: 60 } })).toBe(true)
  })

  it('names the heater that was never asked to heat', () => {
    expect(coldHeaters({ ...hot, bed: { current: 24, target: 0 } })).toEqual(['bed'])
  })

  it('is not at temperature while a heater is still climbing', () => {
    expect(coldHeaters({ ...hot, nozzle: { current: 80, target: 150 } })).toEqual(['nozzle'])
  })

  it('counts a heater the printer does not report as cold', () => {
    // A missing reading is not a heater that happens to be fine.
    expect(coldHeaters({ bed: { current: 59.1, target: 60 } })).toEqual(['nozzle'])
  })
})
