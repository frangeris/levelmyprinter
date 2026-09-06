import type { PointSource } from '../printer/types.ts'

/**
 * A frozen copy of a grid of values, kept in the browser.
 *
 * The live session is already persisted, but it is a single slot that the
 * normal flow keeps overwriting — starting over, loading from the printer and
 * switching printers all wipe it. A draft is the opposite: written once, never
 * touched again, and kept until it falls off the end of the list. That is what
 * makes it something to fall back to when a write does not take.
 */
export interface MeshDraft {
  version: number
  id: string
  /** Epoch ms. Stamped by the caller so this module stays pure. */
  savedAt: number
  label: string
  printerId: string
  cols: number
  rows: number
  /** Z per point, in traversal order. `null` means the point had no value. */
  z: (number | null)[]
  source: (PointSource | null)[]
}

const STORAGE_KEY = 'lmp.drafts'

export const DRAFTS_VERSION = 1

/**
 * Newest kept, oldest dropped. High enough that a session's automatic saves
 * cannot push out the one you actually want, low enough to stay scannable.
 */
export const MAX_DRAFTS = 12

const SOURCES: readonly (PointSource | null)[] = ['measured', 'printer', null]

/**
 * `localStorage` is unavailable in private windows and in the test environment,
 * and throws rather than returning null. Every failure degrades to "no drafts"
 * instead of breaking the app — see `sessionStorage.ts`, same reasoning.
 */
function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/**
 * A draft is only usable on the grid it was taken from: a different size would
 * map its values onto the wrong points, which is the silent corruption this
 * whole app exists to avoid.
 */
function isUsable(value: unknown, printerId: string, cols: number, rows: number): boolean {
  if (typeof value !== 'object' || value === null) return false
  const draft = value as Partial<MeshDraft>

  if (draft.version !== DRAFTS_VERSION) return false
  if (typeof draft.id !== 'string' || draft.id === '') return false
  if (typeof draft.savedAt !== 'number' || !Number.isFinite(draft.savedAt)) return false
  if (typeof draft.label !== 'string') return false
  if (draft.printerId !== printerId) return false
  if (draft.cols !== cols || draft.rows !== rows) return false

  const size = cols * rows
  if (!Array.isArray(draft.z) || draft.z.length !== size) return false
  if (!draft.z.every((entry) => entry === null || typeof entry === 'number')) return false
  if (!Array.isArray(draft.source) || draft.source.length !== size) return false
  if (!draft.source.every((entry) => SOURCES.includes(entry))) return false

  return true
}

/** Everything on disk, valid or not — the raw list, for rewriting it. */
function readAll(storage: Storage | null): unknown[] {
  let raw: string | null = null
  try {
    raw = storage?.getItem(STORAGE_KEY) ?? null
  } catch {
    return []
  }
  if (!raw) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(drafts: unknown[], storage: Storage | null): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(drafts))
  } catch {
    // Quota exceeded or storage disabled. Nothing worth interrupting over.
  }
}

/** The drafts that fit the printer in front of us, newest first. */
export function listDrafts(
  printerId: string,
  cols: number,
  rows: number,
  storage = defaultStorage(),
): MeshDraft[] {
  return readAll(storage)
    .filter((entry): entry is MeshDraft => isUsable(entry, printerId, cols, rows))
    .sort((a, b) => b.savedAt - a.savedAt)
}

/** Stores a draft and trims the list back to `MAX_DRAFTS`. */
export function saveDraft(draft: MeshDraft, storage = defaultStorage()): void {
  const kept = readAll(storage).filter((entry) => (entry as Partial<MeshDraft>)?.id !== draft.id)
  // Sorting here and not only on read: the trim has to drop the genuinely
  // oldest, and the stored order is whatever previous versions left behind.
  const all = [draft, ...kept].sort(
    (a, b) => ((b as MeshDraft).savedAt ?? 0) - ((a as MeshDraft).savedAt ?? 0),
  )
  writeAll(all.slice(0, MAX_DRAFTS), storage)
}

export function deleteDraft(id: string, storage = defaultStorage()): void {
  writeAll(
    readAll(storage).filter((entry) => (entry as Partial<MeshDraft>)?.id !== id),
    storage,
  )
}

export function clearDrafts(storage = defaultStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY)
  } catch {
    // as above
  }
}
