import type { PrinterProfile, Vec2 } from '../printers/types.ts'

const mm = (n: number) => n.toFixed(2)
// Z carries more precision than XY: mechanical resolution is 0.0025 mm
// (M92 Z400) and the finest jog step is 0.01. Two decimals would just barely
// do, leaving no room to add a smaller step to a profile.
const zmm = (n: number) => n.toFixed(3)

/** Clamps against the machine's real motion limits (M211). */
export function clampZ(profile: PrinterProfile, z: number): number {
  return Math.min(Math.max(z, profile.safety.zMin), profile.safety.zMax)
}

export const home = () => 'G28'
export const absolutePositioning = () => 'G90'
export const reportSettings = () => 'M503'
export const reportPosition = () => 'M114'
export const reportTemperatures = () => 'M105'
/**
 * Asks the firmware to report temperatures on its own, every `seconds`.
 *
 * `S0` turns it back off. Only worth sending when `M115` advertises
 * `AUTOREPORT_TEMP`; a firmware built without it answers nothing and the app
 * has to ask each time instead.
 */
export const autoReportTemperatures = (seconds: number) => `M155 S${seconds}`
export const persistSettings = () => 'M500'
export const reloadSettings = () => 'M501'

export const setNozzleTemp = (celsius: number) => `M104 S${celsius}`
export const setBedTemp = (celsius: number) => `M140 S${celsius}`
export const waitNozzleTemp = (celsius: number) => `M109 S${celsius}`
export const waitBedTemp = (celsius: number) => `M190 S${celsius}`

/** Lifts to travel height. Always before an XY move. */
export const raiseToSafeZ = (profile: PrinterProfile) =>
  `G1 Z${zmm(profile.safety.zSafe)} F${profile.feedrates.travelZ}`

export const moveXY = (profile: PrinterProfile, pos: Vec2) =>
  `G1 X${mm(pos.x)} Y${mm(pos.y)} F${profile.feedrates.travelXY}`

export const moveZ = (profile: PrinterProfile, z: number) =>
  `G1 Z${zmm(clampZ(profile, z))} F${profile.feedrates.travelZ}`

/** Fine Z move during the paper adjustment. */
export const jogZ = (profile: PrinterProfile, z: number) =>
  `G1 Z${zmm(clampZ(profile, z))} F${profile.jog.feedrate}`

/**
 * Sequence to reach a point without dragging the nozzle across the bed:
 * lift → travel in XY → only then descend.
 */
export function gotoPoint(profile: PrinterProfile, pos: Vec2): string[] {
  return [raiseToSafeZ(profile), moveXY(profile, pos), moveZ(profile, profile.safety.zStart)]
}
