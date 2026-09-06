export interface Vec2 {
  x: number
  y: number
}

export interface Vec3 extends Vec2 {
  z: number
}

/** Leveling system the firmware uses. v1 only implements 'bilinear'. */
export type LevelingSystem = 'bilinear' | 'mbl' | 'ubl' | 'klipper'

/**
 * Declarative profile for one printer.
 *
 * Everything the app needs to know about a model lives here. Values are derived
 * from the `.capture.txt` sitting next to each profile — see PLAN.md 4.1.
 */
export interface PrinterProfile {
  id: string
  label: string
  /**
   * The exact `MACHINE_TYPE` this firmware reports in `M115`, which is how a
   * connected printer is matched back to a hand-written profile. The label is
   * for people and does not have to agree with it.
   */
  machineType?: string
  baudRate: number

  /** Nominal bed size, used to draw it to scale. */
  bed: { width: number; depth: number }

  /** Real motion limits (M211). The app clamps against these. */
  travel: { min: Vec3; max: Vec3 }

  mesh: {
    cols: number
    rows: number
    /**
     * The points the firmware itself listed, in `M503`'s own order.
     *
     * Present whenever a printer answered: the `G29 W I.. J..` lines say which
     * points exist, so the app enumerates them rather than assuming a full
     * rectangle. Absent in a hand-written profile, which falls back to cols ×
     * rows.
     */
    points?: { i: number; j: number }[]
    /**
     * Grid bounds in mm. Under bilinear these are NOT firmware constants: the
     * app sets them with `G29 L R F B` at the start of every session, which is
     * what makes the index↔mm mapping plain arithmetic. See PLAN.md 10.1.
     */
    min: Vec2
    max: Vec2
    order: 'serpentine' | 'rowMajor'
  }

  leveling: LevelingSystem

  /**
   * Height at which compensation fades out (M420 Z). It matters because paper
   * testing happens in the zone of maximum compensation: it has to be turned
   * off with `M420 S0` or you would measure the old mesh on top of the new one.
   */
  fadeHeight: number

  jog: {
    /** Fine adjustment steps in mm, smallest first. */
    steps: number[]
    /** mm/min for jog moves. */
    feedrate: number
  }

  /** mm/min, already clamped against the M203 ceilings. */
  feedrates: { travelXY: number; travelZ: number }

  safety: {
    /** Travel height between points. */
    zSafe: number
    /** Z on arrival at a point. Never drop straight to 0. */
    zStart: number
    /** Hard floor. A safety policy, not a firmware value. */
    zMin: number
    zMax: number
  }

  preheat?: { nozzle: number; bed: number }
}
