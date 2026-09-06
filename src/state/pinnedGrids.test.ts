import { beforeEach, describe, expect, it } from 'vitest'
import { CR10_SMART } from '../printers/creality-cr10-smart.ts'
import {
  forgetPinnedGrid,
  gridKey,
  isGridPinned,
  pinnedGrid,
  rememberPinnedGrid,
} from './pinnedGrids.ts'

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

const UUID = 'cede2a2f-41a2-4748-9b12-c55c62f367ff'
let storage: Storage

beforeEach(() => {
  storage = fakeStorage()
})

describe('identifying the machine', () => {
  it('prefers the UUID, which is the printer rather than the model', () => {
    expect(gridKey(UUID, 'CR-10 Smart', 'creality-cr10-smart')).toBe(UUID)
  })

  it('falls back through machine name to the profile id', () => {
    expect(gridKey(null, 'CR-10 Smart', 'creality-cr10-smart')).toBe('CR-10 Smart')
    expect(gridKey(null, null, 'creality-cr10-smart')).toBe('creality-cr10-smart')
  })
})

describe('remembering that a grid was pinned', () => {
  it('starts out unpinned', () => {
    expect(isGridPinned(UUID, CR10_SMART, storage)).toBe(false)
  })

  it('stays pinned across sessions, because EEPROM does', () => {
    rememberPinnedGrid(UUID, CR10_SMART, 1_700_000_000_000, 'probed', storage)
    expect(isGridPinned(UUID, CR10_SMART, storage)).toBe(true)
  })

  it('says nothing about a different machine', () => {
    // Two of the same model do not share an EEPROM.
    rememberPinnedGrid(UUID, CR10_SMART, 1, 'probed', storage)
    expect(isGridPinned('another-uuid', CR10_SMART, storage)).toBe(false)
  })

  it('does not carry over to a grid of a different size', () => {
    rememberPinnedGrid(UUID, CR10_SMART, 1, 'probed', storage)
    const other = { ...CR10_SMART, mesh: { ...CR10_SMART.mesh, cols: 4, rows: 4 } }
    expect(isGridPinned(UUID, other, storage)).toBe(false)
  })

  it('does not carry over to different bounds', () => {
    // The record proves the printer was pinned to *those* millimetres. Reusing
    // it for others is the index<->mm mismatch the pinning exists to rule out.
    rememberPinnedGrid(UUID, CR10_SMART, 1, 'probed', storage)
    const moved = { ...CR10_SMART, mesh: { ...CR10_SMART.mesh, min: { x: 15, y: 15 } } }
    expect(isGridPinned(UUID, moved, storage)).toBe(false)
  })

  it('replaces the earlier record for the same machine', () => {
    rememberPinnedGrid(UUID, CR10_SMART, 1, 'probed', storage)
    const moved = { ...CR10_SMART, mesh: { ...CR10_SMART.mesh, min: { x: 15, y: 15 } } }
    rememberPinnedGrid(UUID, moved, 2, 'probed', storage)

    expect(isGridPinned(UUID, moved, storage)).toBe(true)
    expect(isGridPinned(UUID, CR10_SMART, storage)).toBe(false)
  })

  it('forgets on request', () => {
    rememberPinnedGrid(UUID, CR10_SMART, 1, 'probed', storage)
    forgetPinnedGrid(UUID, storage)
    expect(isGridPinned(UUID, CR10_SMART, storage)).toBe(false)
  })

  it('survives corrupt storage instead of throwing', () => {
    storage.setItem('lmp.pinned', '{not json')
    expect(isGridPinned(UUID, CR10_SMART, storage)).toBe(false)
    expect(() => rememberPinnedGrid(UUID, CR10_SMART, 1, 'probed', storage)).not.toThrow()
    expect(isGridPinned(UUID, CR10_SMART, storage)).toBe(true)
  })

  it('degrades quietly when storage is unavailable', () => {
    const hostile = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    } as unknown as Storage

    expect(() => rememberPinnedGrid(UUID, CR10_SMART, 1, 'probed', hostile)).not.toThrow()
    expect(isGridPinned(UUID, CR10_SMART, hostile)).toBe(false)
  })
})

describe('how the bounds came to be known', () => {
  it('remembers that an auto-level run imposed them', () => {
    rememberPinnedGrid(UUID, CR10_SMART, 1, 'probed', storage)

    expect(pinnedGrid(UUID, CR10_SMART, storage)?.source).toBe('probed')
  })

  it('keeps a hand-stated pin apart from a probed one', () => {
    // Both mean "the app may draw the points", but only one of them is the
    // firmware's own word, and the details dialog says which.
    rememberPinnedGrid(UUID, CR10_SMART, 1, 'stated', storage)

    expect(pinnedGrid(UUID, CR10_SMART, storage)?.source).toBe('stated')
    expect(isGridPinned(UUID, CR10_SMART, storage)).toBe(true)
  })

  it('still honours a record written before the source was tracked', () => {
    // Those could only have come from a finished G29. Discarding them would ask
    // people to re-probe a bed that is already pinned.
    storage.setItem(
      'lmp.pinned',
      JSON.stringify([
        {
          version: 1,
          key: UUID,
          cols: 5,
          rows: 5,
          minX: 20,
          maxX: 280,
          minY: 20,
          maxY: 280,
          pinnedAt: 1,
        },
      ]),
    )

    expect(isGridPinned(UUID, CR10_SMART, storage)).toBe(true)
    expect(pinnedGrid(UUID, CR10_SMART, storage)?.source).toBeUndefined()
  })
})
