import type { DetectedPrinter } from '../printer/discovery.ts'
import { loadOverride } from '../state/profileOverrides.ts'
import { PRINTERS } from './registry.ts'
import type { PrinterProfile, Vec2 } from './types.ts'

/**
 * Clearance kept from the bed edge, in mm.
 *
 * Marlin's own `PROBING_MARGIN` default is 10; 20 is the safer read of it,
 * because a probe that misses the sheet on the first point wastes the whole
 * run — and on a nozzle-as-probe machine it means touching down on the frame.
 */
const PROBING_MARGIN_MM = 20

/**
 * Where the grid can physically go.
 *
 * This is the one field no command reports (PLAN.md 10.1), so it is computed
 * rather than read: to put the *probe* at a bed coordinate the *nozzle* has to
 * sit an offset away, and the nozzle is what the soft endstops constrain. The
 * result is still an assumption about where the firmware puts its points — it
 * only becomes true once an auto-level imposes it with `G29 L R F B`.
 */
export function probeableBounds(
  bed: { width: number; depth: number },
  travel: PrinterProfile['travel'],
  probeOffset: { x: number; y: number } | null,
  margin = PROBING_MARGIN_MM,
): { min: Vec2; max: Vec2 } {
  const offset = probeOffset ?? { x: 0, y: 0 }

  const axis = (
    bedSize: number,
    nozzleMin: number,
    nozzleMax: number,
    o: number,
  ): [number, number] => [
    Math.max(nozzleMin + o, margin),
    Math.min(nozzleMax + o, bedSize - margin),
  ]

  const [minX, maxX] = axis(bed.width, travel.min.x, travel.max.x, offset.x)
  const [minY, maxY] = axis(bed.depth, travel.min.y, travel.max.y, offset.y)

  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
}

/**
 * A profile whose values were typed by a human, matched by what `M115` reports.
 *
 * Matched on `machineType`, not on the label: the firmware calls this printer
 * "CR-10 Smart" and the profile calls it "Creality CR-10 Smart", because one is
 * an identifier and the other is for reading.
 */
export function findKnownProfile(detected: DetectedPrinter): PrinterProfile | undefined {
  const machine = detected.machine?.trim().toLowerCase()
  if (!machine) return undefined
  return PRINTERS.find(
    (profile) => (profile.machineType ?? profile.label).trim().toLowerCase() === machine,
  )
}

/**
 * Builds a profile out of what the machine said about itself.
 *
 * Every field falls back individually rather than the whole profile falling
 * back at once: a firmware that answers `M211` but not `M145` should still get
 * its own travel limits. `null` from detection means "did not say", never
 * "said zero", which is why each one is checked separately.
 *
 * `mesh.min`/`max` is the exception and cannot be read from anywhere. What is
 * returned here is a *proposal* — the bounds the app would impose. Whether this
 * machine actually has them is a separate question, answered by the pin record
 * in `state/pinnedGrids.ts`, and nothing is drawn on the bed until it is.
 */
export function deriveProfile(
  detected: DetectedPrinter,
  baudRate: number,
  fallback: PrinterProfile,
  override = loadOverride(machineKey(detected, fallback.id)),
): PrinterProfile {
  const known = findKnownProfile(detected)
  const base = known ?? fallback

  const travel = detected.travel ?? base.travel
  // The bed is the reachable area, not the whole envelope: soft endstops go
  // negative to let the nozzle park off the sheet.
  const width = detected.travel ? Math.max(0, travel.max.x) : base.bed.width
  const depth = detected.travel ? Math.max(0, travel.max.y) : base.bed.depth

  const grid = detected.mesh ?? { cols: base.mesh.cols, rows: base.mesh.rows }
  // Best proposal available, in order: what someone stated for this machine,
  // what a hand-written profile says, then an inset guess. None of the three is
  // proof — that is what the pin record is for.
  const bounds = override
    ? { min: override.min, max: override.max }
    : known && detected.mesh?.cols === known.mesh.cols && detected.mesh.rows === known.mesh.rows
      ? { min: known.mesh.min, max: known.mesh.max }
      : probeableBounds({ width, depth }, travel, detected.probeOffset)

  return {
    // A matched profile keeps its id, so sessions and drafts saved against it
    // survive. Only an unrecognised machine falls back to its UUID.
    id: known?.id ?? detected.uuid ?? base.id,
    label: detected.machine ?? base.label,
    baudRate,
    bed: { width, depth },
    travel,
    mesh: {
      ...grid,
      ...bounds,
      order: base.mesh.order,
      // The list the firmware gave, kept verbatim. Nothing here invents a point.
      ...(detected.meshPoints.length > 0 && { points: detected.meshPoints }),
    },
    leveling: detected.leveling ?? base.leveling,
    fadeHeight: detected.fadeHeight ?? base.fadeHeight,
    jog: base.jog,
    feedrates: {
      // Never above what M203 allows: Marlin would clamp anyway, but sending
      // more hides the mistake until someone copies the number elsewhere.
      travelXY: Math.min(base.feedrates.travelXY, detected.maxFeedrateXY ?? Infinity),
      travelZ: Math.min(base.feedrates.travelZ, detected.maxFeedrateZ ?? Infinity),
    },
    safety: {
      ...base.safety,
      zMax: detected.travel ? travel.max.z : base.safety.zMax,
    },
    ...((detected.preheat ?? base.preheat) && {
      preheat: detected.preheat ?? base.preheat,
    }),
  }
}

/**
 * Identity of the machine, for anything filed against a printer rather than a
 * model. The same order `gridKey` uses, so the two always agree.
 */
export function machineKey(detected: DetectedPrinter, fallbackId: string): string {
  return detected.uuid ?? detected.machine ?? fallbackId
}
