import type { PointSource } from '../printer/types.ts'

export interface StoredSession {
  version: number
  printerId: string
  cols: number
  rows: number
  /** Captured Z per point, in traversal order. `null` means uncaptured. */
  z: (number | null)[]
  /** Where each of those values came from. `null` where `z` is `null`. */
  source: (PointSource | null)[]
  currentIndex: number
  step: number
}

const STORAGE_KEY = 'lmp.session'

/**
 * Bumped whenever the shape changes. An old payload is discarded rather than
 * guessed at: a half-understood session is worse than starting over, because
 * the values end up written to the printer.
 *
 * Version 1 is the one exception, and it is not a guess. It predates loading
 * the mesh from the printer, so every value it holds is one the user measured
 * by hand — that is what the shape meant, not an assumption about it. Twenty
 * minutes of paper work should survive an update.
 */
export const SESSION_VERSION = 2

const SOURCES: readonly (PointSource | null)[] = ['measured', 'printer', null]

/**
 * `localStorage` is unavailable in private windows and in the test environment,
 * and throws rather than returning null. Persistence is a convenience, so every
 * failure degrades to "no saved session" instead of breaking the app.
 */
function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function saveSession(session: StoredSession, storage = defaultStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // Quota exceeded or storage disabled. Nothing to do and nothing worth
    // interrupting the user over.
  }
}

export function clearSession(storage = defaultStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY)
  } catch {
    // as above
  }
}

/**
 * Returns a stored session only when it still fits the printer in front of us.
 * A grid of a different size would silently map values onto the wrong points.
 */
export function loadSession(
  printerId: string,
  cols: number,
  rows: number,
  storage = defaultStorage(),
): StoredSession | null {
  let raw: string | null = null
  try {
    raw = storage?.getItem(STORAGE_KEY) ?? null
  } catch {
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const session = parsed as Partial<StoredSession>

  if (session.version !== SESSION_VERSION && session.version !== 1) return null
  if (session.printerId !== printerId) return null
  if (session.cols !== cols || session.rows !== rows) return null
  if (!Array.isArray(session.z) || session.z.length !== cols * rows) return null
  if (!session.z.every((value) => value === null || typeof value === 'number')) return null
  if (typeof session.currentIndex !== 'number') return null
  if (session.currentIndex < 0 || session.currentIndex >= session.z.length) return null
  if (typeof session.step !== 'number' || session.step <= 0) return null

  const z = session.z
  const source =
    session.version === 1
      ? z.map((value) => (value === null ? null : ('measured' as const)))
      : session.source

  if (!Array.isArray(source) || source.length !== z.length) return null
  if (!source.every((value) => SOURCES.includes(value))) return null

  return { ...(session as StoredSession), version: SESSION_VERSION, source }
}
