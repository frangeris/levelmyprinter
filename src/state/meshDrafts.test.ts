import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearDrafts,
  deleteDraft,
  DRAFTS_VERSION,
  listDrafts,
  MAX_DRAFTS,
  type MeshDraft,
  saveDraft,
} from './meshDrafts.ts'

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

const draft = (overrides: Partial<MeshDraft> = {}): MeshDraft => ({
  version: DRAFTS_VERSION,
  id: 'draft-1',
  savedAt: 1_700_000_000_000,
  label: 'Measured · 25 points',
  printerId: 'creality-cr10-smart',
  cols: 5,
  rows: 5,
  z: Array.from({ length: 25 }, () => -0.1),
  source: Array.from({ length: 25 }, () => 'measured' as const),
  ...overrides,
})

const list = (storage: Storage) => listDrafts('creality-cr10-smart', 5, 5, storage)

let storage: Storage

beforeEach(() => {
  storage = fakeStorage()
})

describe('mesh drafts', () => {
  it('round-trips a draft', () => {
    const one = draft()
    saveDraft(one, storage)
    expect(list(storage)).toEqual([one])
  })

  it('returns nothing when none were saved', () => {
    expect(list(storage)).toEqual([])
  })

  it('lists the newest first', () => {
    saveDraft(draft({ id: 'old', savedAt: 1 }), storage)
    saveDraft(draft({ id: 'new', savedAt: 2 }), storage)

    expect(list(storage).map((entry) => entry.id)).toEqual(['new', 'old'])
  })

  it('drops the oldest once the list is full', () => {
    // The automatic saves would otherwise push out the one you actually wanted.
    for (let n = 0; n < MAX_DRAFTS + 5; n++) {
      saveDraft(draft({ id: `d${n}`, savedAt: n }), storage)
    }

    const kept = list(storage)
    expect(kept).toHaveLength(MAX_DRAFTS)
    expect(kept.at(-1)?.id).toBe(`d${5}`)
  })

  it('hides drafts taken on a different grid', () => {
    // A different grid size would map the values onto the wrong points —
    // exactly the silent corruption this whole app exists to avoid.
    saveDraft(draft({ cols: 7, rows: 7, z: [], source: [] }), storage)
    expect(list(storage)).toEqual([])
  })

  it('hides drafts from another printer', () => {
    saveDraft(draft({ printerId: 'other-printer' }), storage)
    expect(list(storage)).toEqual([])
  })

  it('hides a draft whose source list does not line up with its values', () => {
    saveDraft(draft({ source: ['measured'] }), storage)
    expect(list(storage)).toEqual([])
  })

  it('hides a draft from an older version', () => {
    saveDraft(draft({ version: 0 }), storage)
    expect(list(storage)).toEqual([])
  })

  it('survives corrupt json instead of throwing', () => {
    storage.setItem('lmp.drafts', '{not json')
    expect(list(storage)).toEqual([])
    expect(() => saveDraft(draft(), storage)).not.toThrow()
    expect(list(storage)).toHaveLength(1)
  })

  it('keeps the good drafts when one of them is junk', () => {
    // One bad entry must not take the rest of the backups down with it.
    storage.setItem('lmp.drafts', JSON.stringify([{ nonsense: true }, draft({ id: 'good' })]))
    expect(list(storage).map((entry) => entry.id)).toEqual(['good'])
  })

  it('deletes one without touching the others', () => {
    saveDraft(draft({ id: 'a', savedAt: 1 }), storage)
    saveDraft(draft({ id: 'b', savedAt: 2 }), storage)
    deleteDraft('a', storage)

    expect(list(storage).map((entry) => entry.id)).toEqual(['b'])
  })

  it('replaces rather than duplicates a draft saved under the same id', () => {
    saveDraft(draft({ id: 'a', label: 'first' }), storage)
    saveDraft(draft({ id: 'a', label: 'second' }), storage)

    expect(list(storage)).toHaveLength(1)
    expect(list(storage)[0]?.label).toBe('second')
  })

  it('clears everything', () => {
    saveDraft(draft(), storage)
    clearDrafts(storage)
    expect(list(storage)).toEqual([])
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

    expect(() => saveDraft(draft(), hostile)).not.toThrow()
    expect(() => deleteDraft('a', hostile)).not.toThrow()
    expect(() => clearDrafts(hostile)).not.toThrow()
    expect(listDrafts('creality-cr10-smart', 5, 5, hostile)).toEqual([])
  })
})
