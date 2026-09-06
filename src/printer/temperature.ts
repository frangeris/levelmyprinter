import type { Temperatures } from '../serial/protocol.ts'

/**
 * How far below target a heater may drift and still count as at temperature.
 *
 * Wider than the arrival tolerance on purpose. Bed PID swings a couple of
 * degrees around its setpoint for as long as it is on, and a gate that flicked
 * off every time the number dipped would take the Save button with it in the
 * middle of a pass.
 */
export const READY_TOLERANCE_C = 5

export type HeaterName = 'nozzle' | 'bed'

const HEATERS: HeaterName[] = ['nozzle', 'bed']

/**
 * Which heaters are not at a temperature worth measuring at.
 *
 * A heater counts as cold when it was never asked to heat, when it has not
 * arrived yet, or when there is no reading for it at all — including the case
 * where the printer has said nothing, which is unknown rather than hot, and
 * unknown is not something to measure a bed against.
 */
export function coldHeaters(temperatures: Temperatures | null): HeaterName[] {
  if (!temperatures) return [...HEATERS]
  return HEATERS.filter((name) => {
    const reading = temperatures[name]
    return (
      reading === undefined ||
      reading.target <= 0 ||
      reading.current < reading.target - READY_TOLERANCE_C
    )
  })
}

/**
 * Whether the machine is at the temperature it was told to reach.
 *
 * The bed deforms as it heats and the nozzle — which on a load-cell machine is
 * the probe itself — expands with it. A number measured cold describes a
 * surface that stops existing the moment the printer is used, so it is not a
 * measurement worth saving. See PLAN.md 10.3.
 */
export function isAtTemperature(temperatures: Temperatures | null): boolean {
  return coldHeaters(temperatures).length === 0
}
