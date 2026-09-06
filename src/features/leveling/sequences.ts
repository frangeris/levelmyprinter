import type { PrinterProfile, Vec2 } from '../../printers/types.ts'
import type { LevelingStrategy } from '../../printer/leveling/types.ts'
import {
  absolutePositioning,
  home,
  reloadSettings,
  jogZ,
  moveXY,
  moveZ,
  raiseToSafeZ,
  setBedTemp,
  setNozzleTemp,
  waitBedTemp,
  waitNozzleTemp,
} from '../../printer/gcodeBuilders.ts'

export interface CommandStep {
  label: string
  commands: string[]
  /** ms without receiving anything before aborting. See CommandQueue. */
  idleTimeoutMs?: number
  /**
   * Do not announce this step in the status strip.
   *
   * For anything that finishes in well under a second. The strip is full width
   * and pushes the page down, so a step that appears and vanishes moves the
   * whole layout twice — on a jog, that is on every single click, and the label
   * is gone before it can be read anyway.
   */
  quiet?: boolean
}

/** Homing and probing can stay silent for quite a while. */
const SLOW = 120_000
const MOVE = 30_000

export interface PrepareOptions {
  /** Heat to printing temperature before probing and measuring. */
  preheat: boolean
  /** Run the firmware's auto bed levelling, which also pins the grid bounds. */
  probe: boolean
  /** Overrides the profile's nozzle temperature for this run. */
  nozzle?: number
  /** Overrides the profile's bed temperature for this run. */
  bed?: number
}

/**
 * Session setup.
 *
 * Both heavy steps are optional so the motion can be exercised without waiting
 * minutes for a heat-up and an auto-level run. Skipping them is fine for
 * testing and wrong for a real pass, which is why neither is merely warned
 * about: a cold printer disables Save, and an unpinned grid means there are no
 * points to measure in the first place.
 *
 * Homing is not optional: nothing may move before the machine knows where it is.
 *
 * The order matters when the steps are enabled:
 * 1. Preheat **before** homing and probing. The bed deforms as it heats and the
 *    nozzle expands; measuring cold measures a different surface (PLAN.md 10.3).
 * 2. `G29 L R F B` pins the grid bounds, which is what makes the index↔mm
 *    mapping known rather than guessed (PLAN.md 10.1).
 * 3. Disable compensation **after** the `G29`, because probing leaves it on.
 *    With a 2 mm fade height, paper testing at Z≈0 without disabling it would
 *    measure the old mesh stacked on top of the new one.
 */
export function buildPrepareSteps(
  profile: PrinterProfile,
  strategy: LevelingStrategy,
  options: PrepareOptions,
): CommandStep[] {
  const steps: CommandStep[] = []

  if (options.preheat && profile.preheat) {
    // The profile's M145 values are the default, not the law: the dialog offers
    // them as editable numbers, and a number you can edit but that is ignored
    // is worse than no number at all.
    const nozzle = options.nozzle ?? profile.preheat.nozzle
    const bed = options.bed ?? profile.preheat.bed
    steps.push({
      label: `Preheating to ${nozzle}° / ${bed}°`,
      // Request both temperatures first and only then wait, so they heat in
      // parallel instead of one after the other.
      commands: [setBedTemp(bed), setNozzleTemp(nozzle), waitBedTemp(bed), waitNozzleTemp(nozzle)],
      idleTimeoutMs: SLOW,
    })
  }

  steps.push({ label: 'Homing', commands: [home()], idleTimeoutMs: SLOW })

  if (options.probe) {
    steps.push({
      label: 'Auto-levelling the bed',
      commands: strategy.buildAutoLevel(profile),
      idleTimeoutMs: SLOW,
    })
  }

  // Always: compensation would otherwise skew every paper measurement, whether
  // it came from this session's auto-level run or from whatever was in EEPROM.
  steps.push({
    label: 'Disabling compensation',
    commands: [strategy.buildEnable(false), absolutePositioning()],
  })

  return steps
}

/**
 * Reach a point without dragging the nozzle: lift, travel, only then descend.
 * `z` is the height to arrive at — the already-captured value if there is one,
 * or `zStart` for a fresh point.
 */
export function buildGotoPointStep(profile: PrinterProfile, pos: Vec2, z: number): CommandStep {
  return {
    label: `Moving to X${pos.x} Y${pos.y}`,
    commands: [raiseToSafeZ(profile), moveXY(profile, pos), moveZ(profile, z)],
    idleTimeoutMs: MOVE,
    quiet: true,
  }
}

/** Absolute jog: the destination is explicit, so no drift accumulates. */
export function buildJogStep(profile: PrinterProfile, z: number): CommandStep {
  return {
    label: `Z ${z.toFixed(3)}`,
    commands: [jogZ(profile, z)],
    idleTimeoutMs: MOVE,
    quiet: true,
  }
}

/**
 * Writes the captured mesh and persists it.
 *
 * One step per point rather than a single 26-command batch: this is the
 * riskiest operation in the app, and "writing point 12 of 25" is worth far
 * more to someone watching than an opaque "writing…".
 */
export function buildWriteSteps(
  strategy: LevelingStrategy,
  points: { i: number; j: number; z: number }[],
): CommandStep[] {
  return points.map((point, index) => ({
    label: `Writing point ${index + 1} of ${points.length} (I${point.i} J${point.j})`,
    commands: [strategy.buildWritePoint(point.i, point.j, point.z)],
  }))
}

/** Commits RAM to EEPROM. Its reply carries the firmware's own confirmation. */
export function buildPersistStep(strategy: LevelingStrategy): CommandStep {
  return { label: 'Saving to EEPROM', commands: [strategy.buildPersist()], idleTimeoutMs: SLOW }
}

/**
 * Throws away RAM and reloads from EEPROM.
 *
 * This is what makes the read-back meaningful. `M503` dumps the *live* settings,
 * not the stored ones — after 25 `M421` the values sit in RAM, so `M503` would
 * report them back happily even if `M500` had failed. Only after `M501` does a
 * matching read prove the mesh actually survived.
 */
export function buildReloadStep(): CommandStep {
  return { label: 'Reloading from EEPROM', commands: [reloadSettings()], idleTimeoutMs: SLOW }
}

/** Re-reads stored settings so the write can be verified against them. */
export function buildVerifyStep(strategy: LevelingStrategy): CommandStep {
  return { label: 'Verifying', commands: [strategy.buildVerify()], idleTimeoutMs: MOVE }
}

/** Lifts to travel height and re-enables compensation. Closes the session. */
export function buildFinishStep(profile: PrinterProfile, strategy: LevelingStrategy): CommandStep {
  return {
    label: 'Releasing the bed',
    commands: [raiseToSafeZ(profile), strategy.buildEnable(true)],
    idleTimeoutMs: MOVE,
  }
}
