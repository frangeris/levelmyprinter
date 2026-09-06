import type { PrinterProfile } from '../printers/types.ts'

/**
 * How the bounds came to be known.
 *
 * `probed` is the strong one: `G29 L R F B` finished, so the firmware itself
 * holds these numbers. `stated` is someone typing what they already imposed on
 * the machine — worth trusting, worth labelling differently.
 */
export type GridSource = 'probed' | 'stated'

/**
 * Which machines have had their grid bounds pinned, and to what.
 *
 * `G29 L R F B` writes the bounds to the printer's own EEPROM, where they
 * survive a power cycle — so this is a fact about a machine, not about a
 * session: it is what makes the index↔mm mapping known rather than assumed,
 * and until there is a record the app has no business drawing points at all.
 *
 * Keyed on the `UUID` M115 reports, which identifies the printer rather than
 * the model: two of the same machine do not share an EEPROM.
 */
export interface PinnedGrid {
  version: number
  key: string
  cols: number
  rows: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  pinnedAt: number
  /** Absent in records written before this was tracked; those were all probed. */
  source?: GridSource
}

const STORAGE_KEY = 'lmp.pinned'

export const PINNED_VERSION = 1

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/**
 * Identity of the machine in front of us, best available.
 *
 * Kept in step with `machineKey` in `printers/derive.ts`: the pinned record and
 * the bounds override describe the same printer and must be filed alike.
 */
export function gridKey(uuid: string | null, machine: string | null, printerId: string): string {
  return uuid ?? machine ?? printerId
}

function readAll(storage: Storage | null): PinnedGrid[] {
  let raw: string | null = null
  try {
    raw = storage?.getItem(STORAGE_KEY) ?? null
  } catch {
    return []
  }
  if (!raw) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as PinnedGrid[]) : []
  } catch {
    return []
  }
}

/**
 * This machine's record, but only if it still describes the grid we are about
 * to draw.
 *
 * Every field is compared, not just the key: a record that says 5×5 at 20–280
 * proves nothing about a profile that now wants 4×4, and reusing it would be
 * exactly the silent index↔mm mismatch the pinning exists to rule out.
 */
export function pinnedGrid(
  key: string,
  profile: PrinterProfile,
  storage = defaultStorage(),
): PinnedGrid | null {
  const { cols, rows, min, max } = profile.mesh
  return (
    readAll(storage).find(
      (entry) =>
        entry?.version === PINNED_VERSION &&
        entry.key === key &&
        entry.cols === cols &&
        entry.rows === rows &&
        entry.minX === min.x &&
        entry.maxX === max.x &&
        entry.minY === min.y &&
        entry.maxY === max.y,
    ) ?? null
  )
}

/** Whether this machine's grid was pinned to the bounds we are about to assume. */
export function isGridPinned(
  key: string,
  profile: PrinterProfile,
  storage = defaultStorage(),
): boolean {
  return pinnedGrid(key, profile, storage) !== null
}

/** Records a successful pin. Replaces any earlier record for the same machine. */
export function rememberPinnedGrid(
  key: string,
  profile: PrinterProfile,
  pinnedAt: number,
  source: GridSource = 'probed',
  storage = defaultStorage(),
): void {
  const { cols, rows, min, max } = profile.mesh
  const entry: PinnedGrid = {
    version: PINNED_VERSION,
    key,
    cols,
    rows,
    minX: min.x,
    maxX: max.x,
    minY: min.y,
    maxY: max.y,
    pinnedAt,
    source,
  }

  try {
    const kept = readAll(storage).filter((existing) => existing?.key !== key)
    storage?.setItem(STORAGE_KEY, JSON.stringify([entry, ...kept]))
  } catch {
    // Storage disabled or full. The only cost is being asked again.
  }
}

export function forgetPinnedGrid(key: string, storage = defaultStorage()): void {
  try {
    storage?.setItem(
      STORAGE_KEY,
      JSON.stringify(readAll(storage).filter((entry) => entry?.key !== key)),
    )
  } catch {
    // as above
  }
}
