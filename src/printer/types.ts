import type { Vec2 } from '../printers/types.ts'

export type MeshPointStatus = 'pending' | 'active' | 'captured'

/**
 * Where a point's value came from.
 *
 * A number read out of the printer and a number found with a sheet of paper are
 * both real, but only one of them was checked by a human this session. The grid
 * has to say which is which, or loading the existing mesh would paint 25 points
 * green as if they had all been verified.
 */
export type PointSource = 'measured' | 'printer'

/** A mesh point: firmware indices plus its physical position. */
export interface MeshPointGeometry {
  /** Column, 0..cols-1. The `I` in `G29 W I.. J..`. */
  i: number
  /** Row, 0..rows-1. The `J` in `G29 W I.. J..`. */
  j: number
  /** Physical position in mm, for `G1 X.. Y..`. */
  pos: Vec2
}

/** A point with its measured Z value. */
export interface MeshPoint extends MeshPointGeometry {
  z: number
}
