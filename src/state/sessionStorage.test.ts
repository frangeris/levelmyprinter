import { beforeEach, describe, expect, it } from 'vitest'
import { clearSession, loadSession, saveSession, SESSION_VERSION } from './sessionStorage.ts'

/** Minimal in-memory stand-in; the node test env has no localStorage. */
function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

const valid = {
  version: SESSION_VERSION,
  printerId: 'creality-cr10-smart',
  cols: 5,
  rows: 5,
  z: Array.from({ length: 25 }, (_, i) => (i < 3 ? -0.1 : null)),
  source: Array.from({ length: 25 }, (_, i) => (i < 3 ? ('measured' as const) : null)),
  currentIndex: 3,
  step: 0.05,
}

let storage: Storage

beforeEach(() => {
  storage = fakeStorage()
})

describe('session persistence', () => {
  it('round-trips a session', () => {
    saveSession(valid, storage)
    expect(loadSession('creality-cr10-smart', 5, 5, storage)).toEqual(valid)
  })

  it('returns null when nothing was saved', () => {
    expect(loadSession('creality-cr10-smart', 5, 5, storage)).toBeNull()
  })

  it('refuses a session from a different printer', () => {
    saveSession(valid, storage)
    expect(loadSession('other-printer', 5, 5, storage)).toBeNull()
  })

  it('refuses a session whose grid no longer matches', () => {
    // A different grid size would map stored values onto the wrong points —
    // exactly the silent corruption this whole app exists to avoid.
    saveSession(valid, storage)
    expect(loadSession('creality-cr10-smart', 7, 7, storage)).toBeNull()
  })

  it('refuses a payload from an older version', () => {
    saveSession({ ...valid, version: 0 }, storage)
    expect(loadSession('creality-cr10-smart', 5, 5, storage)).toBeNull()
  })

  it('migrates a version 1 session rather than discarding the work', () => {
    // Version 1 had no `source` because loading from the printer did not exist:
    // every value it holds is one the user measured by hand. Reading it that way
    // is what the old shape meant, not a guess about it.
    const { source: _dropped, ...v1 } = { ...valid, version: 1 }
    storage.setItem('lmp.session', JSON.stringify(v1))

    const loaded = loadSession('creality-cr10-smart', 5, 5, storage)
    expect(loaded?.version).toBe(SESSION_VERSION)
    expect(loaded?.source.slice(0, 3)).toEqual(['measured', 'measured', 'measured'])
    expect(loaded?.source[3]).toBeNull()
  })

  it('refuses a source list that does not line up with the values', () => {
    // Off-by-one here would relabel measured points as read from the printer.
    saveSession({ ...valid, source: ['measured'] }, storage)
    expect(loadSession('creality-cr10-smart', 5, 5, storage)).toBeNull()
  })

  it('refuses an unknown source', () => {
    saveSession({ ...valid, source: valid.source.map(() => 'guessed' as never) }, storage)
    expect(loadSession('creality-cr10-smart', 5, 5, storage)).toBeNull()
  })

  it('refuses corrupt json instead of throwing', () => {
    storage.setItem('lmp.session', '{not json')
    expect(loadSession('creality-cr10-smart', 5, 5, storage)).toBeNull()
  })

  it('refuses a truncated point list', () => {
    saveSession({ ...valid, z: [null, null] }, storage)
    expect(loadSession('creality-cr10-smart', 5, 5, storage)).toBeNull()
  })

  it('refuses an out-of-range current index', () => {
    saveSession({ ...valid, currentIndex: 99 }, storage)
    expect(loadSession('creality-cr10-smart', 5, 5, storage)).toBeNull()
  })

  it('clears what it stored', () => {
    saveSession(valid, storage)
    clearSession(storage)
    expect(loadSession('creality-cr10-smart', 5, 5, storage)).toBeNull()
  })

  it('degrades quietly when storage is unavailable', () => {
    // Private windows throw on access rather than returning null.
    const hostile = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    } as unknown as Storage

    expect(() => saveSession(valid, hostile)).not.toThrow()
    expect(() => clearSession(hostile)).not.toThrow()
    expect(loadSession('creality-cr10-smart', 5, 5, hostile)).toBeNull()
  })
})
