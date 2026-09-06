import { create } from 'zustand'
import type { PrinterProfile } from '../printers/types.ts'
import type { MeshPointGeometry, MeshPointStatus, PointSource } from '../printer/types.ts'
import { buildMeshPoints } from '../printer/meshGeometry.ts'
import { clampZ } from '../printer/gcodeBuilders.ts'
import { clearSession, loadSession, saveSession, SESSION_VERSION } from './sessionStorage.ts'

export interface SessionPoint extends MeshPointGeometry {
  /** `null` until captured. */
  z: number | null
  /** Where that value came from. `null` while uncaptured. */
  source: PointSource | null
}

interface LevelingSessionState {
  /** Which printer the current points belong to, for persistence. */
  printerId: string
  /** The points in traversal (serpentine) order. */
  points: SessionPoint[]
  currentIndex: number
  /** The Z currently being tried at the active point. */
  zTarget: number
  /** Active jog step, in mm. */
  step: number

  start: (profile: PrinterProfile) => void
  reset: () => void
  goTo: (index: number) => void
  next: () => void
  previous: () => void
  nudge: (profile: PrinterProfile, direction: 1 | -1) => void
  /** Jumps straight to a Z, for a value typed rather than nudged into place. */
  setZ: (profile: PrinterProfile, z: number) => void
  setStep: (step: number) => void
  /** Stores the current Z at the active point and jumps to the next pending one. */
  capture: () => void
  /**
   * Fills the grid from the printer's own mesh, matched by index.
   * Returns how many points matched.
   */
  loadFromPrinter: (mesh: { i: number; j: number; z: number }[]) => number
  /** Puts a saved set of values back on the grid, in traversal order. */
  restore: (values: { z: number | null; source: PointSource | null }[]) => void
}

const emptyPoints = (profile: PrinterProfile): SessionPoint[] =>
  buildMeshPoints(profile).map((point) => ({ ...point, z: null, source: null }))

/**
 * Finds the next uncaptured point starting from `from`, wrapping around.
 * If the user steps back to fix an already-saved point, re-saving it should
 * jump to whatever is still missing, not to the one next door.
 */
function nextPendingIndex(points: SessionPoint[], from: number): number | null {
  for (let offset = 1; offset <= points.length; offset++) {
    const index = (from + offset) % points.length
    if (points[index]?.z === null) return index
  }
  return null
}

export const useLevelingSession = create<LevelingSessionState>((set, get) => ({
  printerId: '',
  points: [],
  currentIndex: 0,
  zTarget: 0,
  step: 0.05,

  start: (profile) => {
    const points = emptyPoints(profile)
    const defaults = {
      printerId: profile.id,
      points,
      currentIndex: 0,
      zTarget: 0,
      step: profile.jog.steps[1] ?? 0.05,
    }

    // Twenty minutes of careful paper work should survive an accidental reload.
    const stored = loadSession(profile.id, profile.mesh.cols, profile.mesh.rows)
    if (!stored) {
      set(defaults)
      return
    }

    set({
      ...defaults,
      points: points.map((point, index) => ({
        ...point,
        z: stored.z[index] ?? null,
        source: stored.source[index] ?? null,
      })),
      currentIndex: stored.currentIndex,
      zTarget: stored.z[stored.currentIndex] ?? 0,
      step: stored.step,
    })
  },

  reset: () => {
    clearSession()
    set((state) => ({
      points: state.points.map((point) => ({ ...point, z: null, source: null })),
      currentIndex: 0,
      zTarget: 0,
    }))
  },

  goTo: (index) => {
    const { points } = get()
    if (index < 0 || index >= points.length) return
    // Landing on an already-captured point restores its value so it can be tweaked.
    set({ currentIndex: index, zTarget: points[index]?.z ?? 0 })
  },

  next: () => get().goTo(get().currentIndex + 1),
  previous: () => get().goTo(get().currentIndex - 1),

  nudge: (profile, direction) =>
    set((state) => {
      const raw = state.zTarget + direction * state.step
      // Rounded to a fixed precision, not snapped to a multiple of the step:
      // both stop 20 clicks of 0.01 from landing on 0.19999999999, but snapping
      // also drags every value onto the step grid. Nudge a 0.132 loaded from
      // the printer and it would jump to 0.120 — a 0.012 move, with the 0.002
      // gone for good. Adjusting an existing value is the whole point of the
      // touch-up pass, so what it started from has to survive.
      return { zTarget: clampZ(profile, Number(raw.toFixed(4))) }
    }),

  setZ: (profile, z) => set({ zTarget: clampZ(profile, Number(z.toFixed(4))) }),

  setStep: (step) => set({ step }),

  capture: () =>
    set((state) => {
      const points = state.points.map((point, index) =>
        index === state.currentIndex
          ? { ...point, z: state.zTarget, source: 'measured' as const }
          : point,
      )
      const target = nextPendingIndex(points, state.currentIndex)
      if (target === null) return { points }
      return { points, currentIndex: target, zTarget: points[target]?.z ?? 0 }
    }),

  loadFromPrinter: (mesh) => {
    let loaded = 0
    // Matched by index, never by order: `M503` lists the mesh in whatever order
    // the firmware holds it, and this grid is serpentine.
    const points = get().points.map((point) => {
      const found = mesh.find((entry) => entry.i === point.i && entry.j === point.j)
      if (!found) return point
      loaded += 1
      return { ...point, z: found.z, source: 'printer' as const }
    })

    set({ points, currentIndex: 0, zTarget: points[0]?.z ?? 0 })
    return loaded
  },

  restore: (values) => {
    const current = get().points
    // Positional, so a list of the wrong length would silently shift every
    // value onto a neighbouring point. Refuse rather than half-apply it.
    if (values.length !== current.length) return

    const points = current.map((point, index) => ({
      ...point,
      z: values[index]?.z ?? null,
      source: values[index]?.source ?? null,
    }))
    set({ points, currentIndex: 0, zTarget: points[0]?.z ?? 0 })
  },
}))

/**
 * Persists whatever changed, on every mutation.
 *
 * A subscription rather than a call inside each action: the actions are the
 * domain logic and stay unaware of storage, and nothing can be forgotten when
 * a new one is added.
 */
useLevelingSession.subscribe((state) => {
  if (state.points.length === 0 || !state.printerId) return
  const cols = Math.max(...state.points.map((p) => p.i)) + 1
  const rows = Math.max(...state.points.map((p) => p.j)) + 1
  saveSession({
    version: SESSION_VERSION,
    printerId: state.printerId,
    cols,
    rows,
    z: state.points.map((point) => point.z),
    source: state.points.map((point) => point.source),
    currentIndex: state.currentIndex,
    step: state.step,
  })
})

export function pointStatus(
  point: SessionPoint,
  index: number,
  currentIndex: number,
): MeshPointStatus {
  if (index === currentIndex) return 'active'
  return point.z === null ? 'pending' : 'captured'
}

export const capturedCount = (points: SessionPoint[]): number =>
  points.reduce((total, point) => total + (point.z === null ? 0 : 1), 0)

/** How many values the user actually checked by hand this session. */
export const measuredCount = (points: SessionPoint[]): number =>
  points.reduce((total, point) => total + (point.source === 'measured' ? 1 : 0), 0)

export const isComplete = (points: SessionPoint[]): boolean =>
  points.length > 0 && points.every((point) => point.z !== null)
