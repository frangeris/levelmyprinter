import type { PrinterProfile } from '../../printers/types.ts'
import type { LevelingStrategy } from './types.ts'

/**
 * ABL Bilinear — what the CR-10 Smart runs.
 *
 * Reading and writing are not the same command here, and that is the firmware's
 * doing rather than ours. `M503` serialises the mesh as `G29 W I J Z` lines,
 * which look designed to be replayed — but on this firmware each `G29 W` zeroes
 * the whole grid before setting its own point, so replaying twenty-five of them
 * leaves only the last. Verified against the hardware: two writes, `M503`, one
 * value. It is what destroyed a measured mesh here twice before anyone caught
 * it, because the failure looks exactly like a successful write until you read
 * it back.
 *
 * `M421 I J Z` sets one point and leaves the rest alone, which is what the job
 * needs. Stock Marlin compiles it for MBL and UBL only; Creality left it in.
 */
export const bilinear: LevelingStrategy = {
  id: 'bilinear',

  buildAutoLevel(profile: PrinterProfile) {
    const { min, max } = profile.mesh
    // A plain G29 with the probing area spelled out. L/R/F/B is what makes the
    // firmware's own auto levelling land on the points this app draws —
    // verified against the hardware: Creality did not strip the parsing of
    // these parameters. Note that this G29 auto-saves to EEPROM without being
    // asked (see PLAN.md 10.2).
    return [`G29 L${min.x} R${max.x} F${min.y} B${max.y}`]
  },

  buildEnable(on: boolean) {
    return `M420 S${on ? 1 : 0}`
  },

  buildWritePoint(i: number, j: number, z: number) {
    // Five decimals, which is what M503 emits. Writing three would quietly
    // round every point of a mesh loaded from the printer — including the ones
    // nobody touched — the moment a single point was adjusted.
    return `M421 I${i} J${j} Z${z.toFixed(5)}`
  },

  buildPersist() {
    return 'M500'
  },

  buildVerify() {
    return 'M503'
  },
}
