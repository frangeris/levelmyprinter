import { beforeEach, describe, expect, it } from 'vitest'
import { clearOverride, loadOverride, saveOverride } from './profileOverrides.ts'

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

const KEY = 'uuid-1'
let storage: Storage

beforeEach(() => {
  storage = fakeStorage()
})

describe('grid bound corrections', () => {
  it('round-trips a correction', () => {
    saveOverride(KEY, { x: 15, y: 15 }, { x: 285, y: 285 }, storage)
    expect(loadOverride(KEY, storage)?.min).toEqual({ x: 15, y: 15 })
  })

  it('keeps each machine separate', () => {
    saveOverride(KEY, { x: 15, y: 15 }, { x: 285, y: 285 }, storage)
    expect(loadOverride('another', storage)).toBeNull()
  })

  it('replaces rather than stacking', () => {
    saveOverride(KEY, { x: 15, y: 15 }, { x: 285, y: 285 }, storage)
    saveOverride(KEY, { x: 25, y: 25 }, { x: 275, y: 275 }, storage)
    expect(loadOverride(KEY, storage)?.min).toEqual({ x: 25, y: 25 })
  })

  it('refuses inverted bounds', () => {
    // Negative spacing would mirror every point onto the wrong side of the bed.
    saveOverride(KEY, { x: 280, y: 20 }, { x: 20, y: 280 }, storage)
    expect(loadOverride(KEY, storage)).toBeNull()
  })

  it('refuses values that are not numbers', () => {
    saveOverride(KEY, { x: NaN, y: 20 }, { x: 280, y: 280 }, storage)
    expect(loadOverride(KEY, storage)).toBeNull()
  })

  it('forgets on request', () => {
    saveOverride(KEY, { x: 15, y: 15 }, { x: 285, y: 285 }, storage)
    clearOverride(KEY, storage)
    expect(loadOverride(KEY, storage)).toBeNull()
  })

  it('survives corrupt storage', () => {
    storage.setItem('lmp.overrides', '{not json')
    expect(loadOverride(KEY, storage)).toBeNull()
    expect(() => saveOverride(KEY, { x: 15, y: 15 }, { x: 285, y: 285 }, storage)).not.toThrow()
    expect(loadOverride(KEY, storage)?.max).toEqual({ x: 285, y: 285 })
  })
})
