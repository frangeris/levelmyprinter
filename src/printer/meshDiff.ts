import type { MeshPoint } from './types.ts'
import { findMeshPoint } from './parseM503.ts'

/** Anything carrying a grid index and a (possibly uncaptured) Z. */
export interface IndexedZ {
  i: number
  j: number
  z: number | null
}

export interface MeshDiffRow {
  i: number
  j: number
  /** What the printer holds today, or `null` if it could not be read. */
  current: number | null
  /** What we are about to write. */
  next: number
  /** `next - current`, or `null` without a baseline to compare against. */
  delta: number | null
}

/**
 * Written and reported with 5 decimals, so a match is a match within half of
 * the last written digit — with room for the float32 the firmware stores them
 * in. Demanding exact equality would flag that rounding as a failure.
 */
export const WRITE_TOLERANCE_MM = 0.00005

export function diffMesh(current: MeshPoint[], captured: IndexedZ[]): MeshDiffRow[] {
  return captured
    .filter((point): point is IndexedZ & { z: number } => point.z !== null)
    .map((point) => {
      const existing = findMeshPoint(current, point.i, point.j)
      const currentZ = existing?.z ?? null
      return {
        i: point.i,
        j: point.j,
        current: currentZ,
        next: point.z,
        delta: currentZ === null ? null : point.z - currentZ,
      }
    })
}

export interface VerificationRow {
  i: number
  j: number
  expected: number
  /** What the printer reported back, or `null` if the point went missing. */
  actual: number | null
  ok: boolean
}

/**
 * Compares what we meant to write against what the printer reports afterwards.
 *
 * This is the whole point of re-reading `M503`: a write that silently did not
 * take is indistinguishable from a successful one until you check.
 */
export function verifyWrite(expected: IndexedZ[], actual: MeshPoint[]): VerificationRow[] {
  return expected
    .filter((point): point is IndexedZ & { z: number } => point.z !== null)
    .map((point) => {
      const reported = findMeshPoint(actual, point.i, point.j)
      const actualZ = reported?.z ?? null
      return {
        i: point.i,
        j: point.j,
        expected: point.z,
        actual: actualZ,
        ok: actualZ !== null && Math.abs(actualZ - point.z) <= WRITE_TOLERANCE_MM,
      }
    })
}

export const allVerified = (rows: VerificationRow[]): boolean =>
  rows.length > 0 && rows.every((row) => row.ok)
