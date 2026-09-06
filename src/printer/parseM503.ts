import type { MeshPoint } from './types.ts'

export interface PrinterSettings {
  /** Mesh points as the printer reports them, in the order they were listed. */
  mesh: MeshPoint[]
  /** `M420 S1 Z2.00` → compensation enabled and its fade height. */
  leveling?: { enabled: boolean; fadeHeight: number }
  /** `M851 X0 Y0 Z0.31` → probe offset. */
  probeOffset?: { x: number; y: number; z: number }
}

/**
 * Parses the `M503` dump.
 *
 * Only the fields the app actually uses are extracted. Everything else is left
 * alone on purpose: the less of Marlin's free-form text we depend on, the less
 * a firmware update can silently break.
 *
 * Mesh values come from the `G29 W I.. J.. Z..` lines the firmware emits for
 * its own settings — the same lines we replay to write them back.
 */
export function parseM503(raw: string): PrinterSettings {
  const settings: PrinterSettings = { mesh: [] }

  for (const line of raw.split('\n')) {
    // Lines arrive prefixed with `echo:` and padded; normalise before matching.
    const text = line.replace(/^echo:\s*/, '').trim()

    const meshPoint = /^G29 W I(\d+) J(\d+) Z(-?\d+\.?\d*)/.exec(text)
    if (meshPoint) {
      settings.mesh.push({
        i: Number(meshPoint[1]),
        j: Number(meshPoint[2]),
        z: Number(meshPoint[3]),
        // M503 does not report physical positions — only indices. The mapping
        // comes from the profile, not from here (see PLAN.md 10.1).
        pos: { x: NaN, y: NaN },
      })
      continue
    }

    const leveling = /^M420 S(\d)(?:\s+Z(-?\d+\.?\d*))?/.exec(text)
    if (leveling) {
      settings.leveling = {
        enabled: leveling[1] === '1',
        fadeHeight: leveling[2] === undefined ? 0 : Number(leveling[2]),
      }
      continue
    }

    const probe = /^M851 X(-?\d+\.?\d*) Y(-?\d+\.?\d*) Z(-?\d+\.?\d*)/.exec(text)
    if (probe) {
      settings.probeOffset = {
        x: Number(probe[1]),
        y: Number(probe[2]),
        z: Number(probe[3]),
      }
    }
  }

  return settings
}

/** Looks a mesh point up by its grid index. */
export function findMeshPoint(mesh: MeshPoint[], i: number, j: number): MeshPoint | undefined {
  return mesh.find((point) => point.i === i && point.j === j)
}
