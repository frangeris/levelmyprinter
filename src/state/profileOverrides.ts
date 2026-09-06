import type { Vec2 } from '../printers/types.ts'

/**
 * Corrections a human made to what the app worked out on its own.
 *
 * Only the grid bounds, because they are the only field the app *guesses*:
 * everything else in a derived profile came from a command the printer
 * answered, and letting someone overrule a measurement with a preference is
 * how a mesh ends up written to the wrong places.
 *
 * Keyed on the machine, like the pinned record — bounds belong to a printer.
 */
export interface ProfileOverride {
  version: number
  key: string
  min: Vec2
  max: Vec2
}

const STORAGE_KEY = 'lmp.overrides'

export const OVERRIDE_VERSION = 1

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readAll(storage: Storage | null): ProfileOverride[] {
  let raw: string | null = null
  try {
    raw = storage?.getItem(STORAGE_KEY) ?? null
  } catch {
    return []
  }
  if (!raw) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ProfileOverride[]) : []
  } catch {
    return []
  }
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** Rejects anything that would put the grid somewhere impossible. */
function isUsable(entry: ProfileOverride | undefined): boolean {
  if (!entry || entry.version !== OVERRIDE_VERSION) return false
  const { min, max } = entry
  if (!finite(min?.x) || !finite(min?.y) || !finite(max?.x) || !finite(max?.y)) return false
  // A grid needs width to have spacing at all; inverted bounds would make
  // meshSpacing negative and mirror every point.
  return max.x > min.x && max.y > min.y
}

export function loadOverride(key: string, storage = defaultStorage()): ProfileOverride | null {
  const found = readAll(storage).find((entry) => entry?.key === key)
  return isUsable(found) ? (found as ProfileOverride) : null
}

export function saveOverride(key: string, min: Vec2, max: Vec2, storage = defaultStorage()): void {
  const entry: ProfileOverride = { version: OVERRIDE_VERSION, key, min, max }
  if (!isUsable(entry)) return

  try {
    const kept = readAll(storage).filter((existing) => existing?.key !== key)
    storage?.setItem(STORAGE_KEY, JSON.stringify([entry, ...kept]))
  } catch {
    // Storage disabled. The correction lasts this session only.
  }
}

export function clearOverride(key: string, storage = defaultStorage()): void {
  try {
    storage?.setItem(
      STORAGE_KEY,
      JSON.stringify(readAll(storage).filter((entry) => entry?.key !== key)),
    )
  } catch {
    // as above
  }
}
