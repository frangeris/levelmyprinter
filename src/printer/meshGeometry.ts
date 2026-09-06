import type { PrinterProfile, Vec2 } from '../printers/types.ts'
import type { MeshPointGeometry } from './types.ts'

/**
 * Distance in mm between adjacent grid points.
 *
 * The bounds (`mesh.min`/`mesh.max`) are imposed by the app via `G29 L R F B`,
 * so this mapping is exact by construction and does not depend on any firmware
 * constant. See PLAN.md 10.1.
 */
export function meshSpacing(profile: PrinterProfile): Vec2 {
  const { cols, rows, min, max } = profile.mesh
  return {
    x: (max.x - min.x) / (cols - 1),
    y: (max.y - min.y) / (rows - 1),
  }
}

/** Grid index (i,j) → physical position in mm. */
export function meshPointPosition(profile: PrinterProfile, i: number, j: number): Vec2 {
  const spacing = meshSpacing(profile)
  return {
    x: profile.mesh.min.x + i * spacing.x,
    y: profile.mesh.min.y + j * spacing.y,
  }
}

/**
 * The mesh points in traversal order.
 *
 * *Which* points exist is read, not assumed: `M503` replays the mesh as one
 * `G29 W I.. J..` per point, so a connected printer hands over its own list and
 * this walks that. Only a hand-written profile with nothing detected falls back
 * to a full cols × rows rectangle.
 *
 * The order is ours, not the firmware's. Serpentine alternates row direction,
 * which keeps travel between consecutive points to a minimum.
 */
export function buildMeshPoints(profile: PrinterProfile): MeshPointGeometry[] {
  const { cols, rows, order, points: reported } = profile.mesh

  const indices =
    reported && reported.length > 0
      ? reported
      : Array.from({ length: rows }, (_, j) =>
          Array.from({ length: cols }, (_, i) => ({ i, j })),
        ).flat()

  const rowsPresent = [...new Set(indices.map((point) => point.j))].sort((a, b) => a - b)

  return rowsPresent.flatMap((j) => {
    const inRow = indices.filter((point) => point.j === j).sort((a, b) => a.i - b.i)
    const walked = order === 'serpentine' && j % 2 === 1 ? [...inRow].reverse() : inRow
    return walked.map(({ i }) => ({ i, j, pos: meshPointPosition(profile, i, j) }))
  })
}

/**
 * Bed coordinate (mm) → screen coordinate inside a `width`×`height` viewBox.
 *
 * Y is flipped: on the bed it grows toward the back, in SVG it grows downward.
 * Without this the drawing comes out mirrored relative to what someone standing
 * in front of the printer actually sees.
 */
export function bedToScreen(
  profile: PrinterProfile,
  pos: Vec2,
  width: number,
  height: number,
): Vec2 {
  return {
    x: (pos.x / profile.bed.width) * width,
    y: height - (pos.y / profile.bed.depth) * height,
  }
}
