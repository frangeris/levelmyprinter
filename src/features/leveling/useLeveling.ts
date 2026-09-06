import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PrinterProfile } from '../../printers/types.ts'
import { bilinear } from '../../printer/leveling/bilinear.ts'
import { usePrinterStore } from '../../state/printerStore.ts'
import {
  capturedCount,
  isComplete,
  type SessionPoint,
  useLevelingSession,
} from '../../state/levelingSession.ts'
import {
  deleteDraft,
  DRAFTS_VERSION,
  listDrafts,
  type MeshDraft,
  saveDraft,
} from '../../state/meshDrafts.ts'
import { findMeshPoint } from '../../printer/parseM503.ts'
import { coldHeaters, type HeaterName } from '../../printer/temperature.ts'
import { gridKey, pinnedGrid, rememberPinnedGrid } from '../../state/pinnedGrids.ts'
import type { MeshPoint, PointSource } from '../../printer/types.ts'
import { parseM503 } from '../../printer/parseM503.ts'
import {
  allVerified,
  diffMesh,
  type MeshDiffRow,
  type VerificationRow,
  verifyWrite,
} from '../../printer/meshDiff.ts'
import {
  buildFinishStep,
  buildGotoPointStep,
  buildJogStep,
  buildPrepareSteps,
  buildPersistStep,
  buildReloadStep,
  buildVerifyStep,
  buildWriteSteps,
  type PrepareOptions,
} from './sequences.ts'

/** What came back from a read of the printer's mesh. */
export interface MeshLoadResult {
  loaded: number
  /**
   * How many of those came back as exactly zero.
   *
   * Worth counting separately: an unprobed bilinear grid reads as all zeros, so
   * "loaded 25 points" and "the printer has nothing" look identical from the
   * count alone.
   */
  zeros: number
}

/** Where the "save to printer" flow stands. */
export type WriteState =
  | { phase: 'idle' }
  /** Reading the current mesh so there is something to compare against. */
  | { phase: 'loading' }
  | { phase: 'review'; rows: MeshDiffRow[]; commands: string[] }
  | { phase: 'writing' }
  /**
   * The firmware took the write and threw away everything else.
   *
   * Reached by the canary below, after two points instead of after all
   * twenty-five. `kept` is the one value that survived, which is what makes the
   * diagnosis legible rather than a bare failure.
   */
  | { phase: 'unsupported'; kept: { i: number; j: number; z: number } | null }
  | {
      phase: 'done'
      rows: VerificationRow[]
      ok: boolean
      /** Whether `M500` reported storing the settings. */
      persisted: boolean
      /** The chain that was actually run, for the summary line. */
      trail: string[]
    }

const capturedPoints = () =>
  useLevelingSession
    .getState()
    .points.filter((point): point is typeof point & { z: number } => point.z !== null)

const NOTHING_DONE: PrepareOptions = { preheat: false, probe: false }

/** One value per point, in traversal order — the shape a draft stores. */
type DraftEntries = { z: number | null; source: PointSource | null }[]

const entriesOfSession = (points: SessionPoint[]): DraftEntries =>
  points.map((point) => ({ z: point.z, source: point.source }))

/** The printer's own mesh, laid out in this grid's traversal order. */
const entriesOfMesh = (points: SessionPoint[], mesh: MeshPoint[]): DraftEntries =>
  points.map((point) => {
    const found = findMeshPoint(mesh, point.i, point.j)
    return { z: found?.z ?? null, source: found ? ('printer' as const) : null }
  })

const newDraftId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

function buildDraft(
  label: string,
  profile: PrinterProfile,
  entries: DraftEntries,
  savedAt: number,
): MeshDraft {
  return {
    version: DRAFTS_VERSION,
    id: newDraftId(),
    savedAt,
    label,
    printerId: profile.id,
    cols: profile.mesh.cols,
    rows: profile.mesh.rows,
    z: entries.map((entry) => entry.z),
    source: entries.map((entry) => entry.source),
  }
}

/**
 * `G29 W I0 J0 Z0.000` -> `G29 W`: the command without its per-point values.
 *
 * The summary line names the chain that ran, and it has to name the real one.
 * Deriving it from the strategy keeps a hardcoded mnemonic in the UI from
 * quietly disagreeing with what the app sends.
 */
const mnemonic = (command: string) => command.replace(/\s+[A-Z]-?\d[\d.]*/g, '')

/**
 * Bridges the session state to the printer.
 *
 * Connecting is enough to drive the machine — there is no preparation gate.
 * The one thing that cannot be skipped is homing, so it happens lazily on the
 * first move that needs it rather than as a step the user has to remember.
 *
 * Preheating and probing stay available as an explicit extra, because they are
 * what makes the measurements *valid* even though they are not what makes the
 * machine *move*.
 */
export function useLeveling(profile: PrinterProfile) {
  const status = usePrinterStore((s) => s.status)
  const busy = usePrinterStore((s) => s.busy)
  const activity = usePrinterStore((s) => s.activity)
  const runStep = usePrinterStore((s) => s.runStep)
  const runQuery = usePrinterStore((s) => s.runQuery)
  const appendLog = usePrinterStore((s) => s.appendLog)

  const detected = usePrinterStore((s) => s.detected)
  const live = status === 'connected'

  /**
   * Whether the machine is hot enough for a measurement to mean anything.
   *
   * Read from the printer rather than from whether the app ran a preheat: the
   * bed can just as well have been heated from the printer's own screen, and it
   * can cool down again halfway through a pass. Only the live reading knows.
   *
   * Selected down to a string on purpose. A reading lands every two seconds and
   * subscribing to the object itself would re-render this whole tree each time;
   * what actually matters here changes when a heater crosses its target, which
   * is a handful of times a session.
   */
  const coldKey = usePrinterStore((s) => coldHeaters(s.temperatures).join(' '))
  const cold = useMemo(() => (coldKey ? (coldKey.split(' ') as HeaterName[]) : []), [coldKey])
  const hot = cold.length === 0

  /**
   * Where this machine's grid actually sits, if anyone has established it.
   *
   * Not a fact about this session: `G29 L R F B` writes the bounds to the
   * printer's EEPROM, so they outlive the tab by a long way. Until there is a
   * record the app knows the grid's *size* — `M503` reports that — but not
   * which millimetres it covers, and nothing may draw a point.
   */
  const machineKey = gridKey(detected?.uuid ?? null, detected?.machine ?? null, profile.id)
  const [pinned, setPinned] = useState(() => pinnedGrid(machineKey, profile))

  useEffect(() => {
    setPinned(pinnedGrid(machineKey, profile))
  }, [machineKey, profile])

  const gridVerified = pinned !== null

  // Which of the optional steps actually ran.
  const [prep, setPrep] = useState<PrepareOptions>(NOTHING_DONE)

  // Ref for the guard logic, state for the UI: the callbacks below need the
  // value synchronously, the modal needs to re-render when it flips.
  const [write, setWrite] = useState<WriteState>({ phase: 'idle' })

  const homed = useRef(false)
  const [isHomed, setIsHomed] = useState(false)
  const homing = useRef<Promise<void> | null>(null)

  // Disconnecting invalidates everything: the machine may have moved, cooled
  // down or reset. Never assume the state survived.
  useEffect(() => {
    if (status !== 'connected') {
      homed.current = false
      homing.current = null
      setIsHomed(false)
      setPrep(NOTHING_DONE)
      setWrite({ phase: 'idle' })
    }
  }, [status])

  // Drafts live in localStorage; this mirror is what the UI renders, refreshed
  // after every mutation rather than re-read on each paint.
  const [drafts, setDrafts] = useState<MeshDraft[]>([])
  const refreshDrafts = useCallback(() => {
    setDrafts(listDrafts(profile.id, profile.mesh.cols, profile.mesh.rows))
  }, [profile])

  useEffect(refreshDrafts, [refreshDrafts])

  /**
   * Freezes a copy of some grid of values.
   *
   * Called at each point where something is about to become unrecoverable, and
   * deliberately never allowed to throw: a backup that blocks the operation it
   * was protecting is worse than no backup.
   */
  const keepDraft = useCallback(
    (label: string, entries: DraftEntries) => {
      try {
        saveDraft(buildDraft(label, profile, entries, Date.now()))
        refreshDrafts()
      } catch {
        // Storage disabled or full. Already degraded inside saveDraft; this is
        // the last line of defence.
      }
    },
    [profile, refreshDrafts],
  )

  const report = useCallback(
    (error: unknown) => appendLog('error', error instanceof Error ? error.message : String(error)),
    [appendLog],
  )

  /**
   * Homes and disables compensation, once. Marlin refuses to move before it
   * knows where it is, so this has to happen before the first command — but it
   * is not something the user should have to know about.
   *
   * Guarded by a promise, not just a flag: two controls pressed at once would
   * otherwise both see `homed === false` and send `G28` twice.
   */
  const ensureHomed = useCallback((): Promise<void> => {
    if (homed.current) return Promise.resolve()
    if (!homing.current) {
      homing.current = (async () => {
        for (const step of buildPrepareSteps(profile, bilinear, NOTHING_DONE)) {
          await runStep(step)
        }
        homed.current = true
        setIsHomed(true)
      })().finally(() => {
        homing.current = null
      })
    }
    return homing.current
  }, [profile, runStep])

  // --- coalescing jog -------------------------------------------------------
  // Clicking ▲ ten times fast must not queue ten moves: since the destination
  // is absolute, only the last one matters. While one is in flight the most
  // recent value is held and sent when it finishes.
  const jogInFlight = useRef(false)
  const pendingZ = useRef<number | null>(null)

  const applyZ = useCallback(
    async (z: number) => {
      if (!live) return
      if (jogInFlight.current) {
        pendingZ.current = z
        return
      }
      jogInFlight.current = true
      try {
        await ensureHomed()
        let target: number | null = z
        while (target !== null) {
          await runStep(buildJogStep(profile, target))
          target = pendingZ.current
          pendingZ.current = null
        }
      } catch (error) {
        report(error)
      } finally {
        jogInFlight.current = false
      }
    },
    [live, profile, runStep, ensureHomed, report],
  )

  const moveToCurrentPoint = useCallback(async () => {
    if (!live) return
    const { points, currentIndex } = useLevelingSession.getState()
    const point = points[currentIndex]
    if (!point) return
    try {
      await ensureHomed()
      await runStep(buildGotoPointStep(profile, point.pos, point.z ?? profile.safety.zStart))
    } catch (error) {
      report(error)
    }
  }, [live, profile, runStep, ensureHomed, report])

  // --- actions exposed to the UI -------------------------------------------

  /** The optional heavy steps: preheat and/or a fresh auto-level run. */
  const prepare = useCallback(
    async (chosen: PrepareOptions) => {
      if (!live) return
      try {
        // `G29` zeroes the whole grid before it starts probing, and this
        // firmware saves to EEPROM on its own — so an aborted run destroys
        // whatever was in there, permanently. Copy it out first.
        if (chosen.probe) {
          try {
            const before = parseM503(await runQuery(buildVerifyStep(bilinear)))
            const { points } = useLevelingSession.getState()
            keepDraft('Printer mesh, before auto-levelling', entriesOfMesh(points, before.mesh))
          } catch {
            appendLog('error', 'Could not back up the current mesh before auto-levelling.')
          }
        }

        for (const step of buildPrepareSteps(profile, bilinear, chosen)) {
          await runStep(step)
        }
        homed.current = true
        setIsHomed(true)
        setPrep((done) => ({
          preheat: done.preheat || chosen.preheat,
          probe: done.probe || chosen.probe,
        }))
        if (chosen.probe) {
          // Only now: the bounds are in EEPROM because the run finished, and a
          // run that threw got nowhere near this line.
          rememberPinnedGrid(machineKey, profile, Date.now(), 'probed')
          setPinned(pinnedGrid(machineKey, profile))
        }
        appendLog('info', 'Printer prepared.')
        await moveToCurrentPoint()
      } catch (error) {
        report(error)
      }
    },
    [
      live,
      profile,
      machineKey,
      runStep,
      runQuery,
      appendLog,
      keepDraft,
      moveToCurrentPoint,
      report,
    ],
  )

  /**
   * Homes on demand, for the modal shown right after connecting.
   *
   * Returns whether it worked, because the caller is a blocking modal: with the
   * log inert behind it, a silent failure would leave the user staring at a
   * dialog with no way forward and no idea why.
   */
  const home = useCallback(async (): Promise<boolean> => {
    if (!live) return false
    try {
      await ensureHomed()
      return true
    } catch (error) {
      report(error)
      return false
    }
  }, [live, ensureHomed, report])

  const goToPoint = useCallback(
    async (index: number) => {
      useLevelingSession.getState().goTo(index)
      await moveToCurrentPoint()
    },
    [moveToCurrentPoint],
  )

  const next = useCallback(async () => {
    await goToPoint(useLevelingSession.getState().currentIndex + 1)
  }, [goToPoint])

  const previous = useCallback(async () => {
    await goToPoint(useLevelingSession.getState().currentIndex - 1)
  }, [goToPoint])

  const nudge = useCallback(
    (direction: 1 | -1) => {
      useLevelingSession.getState().nudge(profile, direction)
      void applyZ(useLevelingSession.getState().zTarget)
    },
    [profile, applyZ],
  )

  /**
   * Goes to an exact Z, for a value that was typed.
   *
   * The steps can only ever reach multiples of themselves, so a mesh value like
   * 0.154 loaded from the printer has no route to 0.155 by nudging. Typing is
   * the general answer — a finer step would only move the wall.
   */
  const setZ = useCallback(
    (z: number) => {
      useLevelingSession.getState().setZ(profile, z)
      void applyZ(useLevelingSession.getState().zTarget)
    },
    [profile, applyZ],
  )

  const capture = useCallback(async () => {
    const before = useLevelingSession.getState()
    // Whether the grid was *already* full matters, not just whether it is now:
    // re-saving one point of a mesh loaded from the printer leaves nothing
    // pending either, and that must not be read as the pass having just ended.
    const wasComplete = isComplete(before.points)
    useLevelingSession.getState().capture()

    if (useLevelingSession.getState().currentIndex !== before.currentIndex) {
      await moveToCurrentPoint()
      return
    }
    // The last pending point just went in: release the bed. Touching up an
    // already-complete grid must not switch compensation back on underneath
    // someone who is still working.
    if (live && !wasComplete) {
      try {
        await runStep(buildFinishStep(profile, bilinear))
      } catch (error) {
        report(error)
      }
    }
  }, [live, profile, runStep, moveToCurrentPoint, report])

  /**
   * Pulls the mesh the printer is using into the session, so a pass can start
   * from what is already there instead of from nothing.
   *
   * Reads live settings, not EEPROM: this asks what the machine is working with
   * right now, which is the thing you would be adjusting. Values are matched by
   * grid index — a point the printer does not report is left uncaptured rather
   * than filled with a zero that would look like a measurement.
   *
   * Returns what came back, or `null` if the read failed.
   */
  const loadFromPrinter = useCallback(async (): Promise<MeshLoadResult | null> => {
    if (!live) return null

    // Same guarantee as a restore: filling the grid from the machine must not
    // be the thing that loses what is already on it.
    const before = useLevelingSession.getState().points
    if (capturedCount(before) > 0) {
      keepDraft(`Replaced by a load · ${capturedCount(before)} points`, entriesOfSession(before))
    }

    try {
      const stored = parseM503(await runQuery(buildVerifyStep(bilinear)))
      const loaded = useLevelingSession.getState().loadFromPrinter(stored.mesh)
      const zeros = useLevelingSession
        .getState()
        .points.filter((point) => point.source === 'printer' && point.z === 0).length

      appendLog(
        loaded > 0 ? 'info' : 'error',
        loaded > 0
          ? `Loaded ${loaded} mesh points from the printer (${zeros} of them zero).`
          : 'The printer reported no mesh to load.',
      )
      if (loaded > 0) await moveToCurrentPoint()
      return { loaded, zeros }
    } catch (error) {
      report(error)
      return null
    }
  }, [live, runQuery, appendLog, keepDraft, moveToCurrentPoint, report])

  /** Freezes the grid as it stands now, on demand. */
  const saveDraftNow = useCallback(() => {
    const { points } = useLevelingSession.getState()
    const filled = capturedCount(points)
    keepDraft(`Saved by hand · ${filled} of ${points.length} points`, entriesOfSession(points))
  }, [keepDraft])

  /**
   * Puts a draft back on the grid.
   *
   * The grid it replaces is frozen first, so restoring can never be the thing
   * that loses work — including a restore you did not mean to do.
   */
  const restoreDraft = useCallback(
    async (id: string): Promise<boolean> => {
      const draft = drafts.find((entry) => entry.id === id)
      if (!draft) return false

      const { points } = useLevelingSession.getState()
      if (capturedCount(points) > 0) {
        keepDraft(
          `Replaced by a restore · ${capturedCount(points)} points`,
          entriesOfSession(points),
        )
      }

      useLevelingSession
        .getState()
        .restore(draft.z.map((z, index) => ({ z, source: draft.source[index] ?? null })))
      appendLog('info', `Restored the measure "${draft.label}".`)
      await moveToCurrentPoint()
      return true
    },
    [drafts, keepDraft, appendLog, moveToCurrentPoint],
  )

  const removeDraft = useCallback(
    (id: string) => {
      deleteDraft(id)
      refreshDrafts()
    },
    [refreshDrafts],
  )

  const reset = useCallback(async () => {
    useLevelingSession.getState().reset()
    setWrite({ phase: 'idle' })
    await moveToCurrentPoint()
  }, [moveToCurrentPoint])

  // --- save to printer ------------------------------------------------------

  /**
   * Reads the mesh the printer holds today, so the review can show what each
   * value replaces rather than just what is about to be written.
   */
  const openReview = useCallback(async () => {
    const captured = capturedPoints()
    const commands = [
      ...buildWriteSteps(bilinear, captured),
      buildPersistStep(bilinear),
      buildReloadStep(),
      buildVerifyStep(bilinear),
    ].flatMap((step) => step.commands)

    if (!live) {
      setWrite({ phase: 'review', rows: diffMesh([], captured), commands })
      return
    }

    setWrite({ phase: 'loading' })
    try {
      const current = parseM503(await runQuery(buildVerifyStep(bilinear)))
      setWrite({ phase: 'review', rows: diffMesh(current.mesh, captured), commands })
    } catch (error) {
      report(error)
      // A failed read is not a reason to block the write: show the rows without
      // a baseline instead of dropping the user back to square one.
      setWrite({ phase: 'review', rows: diffMesh([], captured), commands })
    }
  }, [live, runQuery, report])

  const closeReview = useCallback(() => setWrite({ phase: 'idle' }), [])

  /**
   * Writes the captured mesh, persists it, then reads it back.
   *
   * The read-back is the point: a write that silently did not take looks
   * exactly like one that did, until you compare.
   */
  const confirmWrite = useCallback(async () => {
    if (!live) return
    const captured = capturedPoints()

    // Two copies before anything is overwritten: the measurements, which are
    // the irreplaceable half-hour of work, and the mesh about to be replaced.
    const { points } = useLevelingSession.getState()
    keepDraft(`Measured · ${captured.length} points, about to write`, entriesOfSession(points))
    if (write.phase === 'review') {
      keepDraft(
        'Printer mesh, before writing',
        points.map((point) => {
          const row = write.rows.find((entry) => entry.i === point.i && entry.j === point.j)
          const z = row?.current ?? null
          return { z, source: z === null ? null : ('printer' as const) }
        }),
      )
    }

    setWrite({ phase: 'writing' })
    try {
      // Canary: two points, then read the mesh back before committing the rest.
      //
      // `G29 W` — the command M503 itself replays — turned out to zero the
      // whole grid on every call, so a full pass left only the last value. It
      // destroyed a measured mesh here twice before anyone read the result
      // back, because a wiping write and a working one look identical until you
      // do. `M421` behaves, but the check stays: two writes cost nothing next
      // to the twenty-five behind them, and no firmware gets the benefit of the
      // doubt on this again.
      const steps = buildWriteSteps(bilinear, captured)
      const canary = captured.slice(0, 2)
      if (canary.length === 2) {
        for (const step of steps.slice(0, 2)) await runStep(step)
        const after = parseM503(await runQuery(buildVerifyStep(bilinear))).mesh
        const landed = canary.filter((point) => {
          const found = findMeshPoint(after, point.i, point.j)
          return found !== undefined && Math.abs(found.z - point.z) < 0.0005
        })

        if (landed.length < 2) {
          const kept = landed[0] ?? null
          setWrite({ phase: 'unsupported', kept: kept && { i: kept.i, j: kept.j, z: kept.z } })
          appendLog(
            'error',
            `This firmware clears the mesh on every ${mnemonic(
              bilinear.buildWritePoint(0, 0, 0),
            )}, so points cannot be written one by one.`,
          )
          return
        }
      }

      for (const step of steps.slice(canary.length === 2 ? 2 : 0)) {
        await runStep(step)
      }

      // The firmware announces its own EEPROM write; the absence of that line
      // is a failure even when everything else looks fine.
      const saveReply = await runQuery(buildPersistStep(bilinear))
      const persisted = /Settings Stored/i.test(saveReply)

      // Discard RAM before reading back, or the read just echoes the values we
      // put there and proves nothing about what survived.
      await runStep(buildReloadStep())
      const stored = parseM503(await runQuery(buildVerifyStep(bilinear)))

      const rows = verifyWrite(captured, stored.mesh)
      const ok = allVerified(rows) && persisted
      const trail = [
        `${mnemonic(bilinear.buildWritePoint(0, 0, 0))} \u00d7${captured.length}`,
        ...[buildPersistStep(bilinear), buildReloadStep(), buildVerifyStep(bilinear)].flatMap(
          (step) => step.commands,
        ),
      ]
      setWrite({ phase: 'done', rows, ok, persisted, trail })
      appendLog(
        'info',
        ok ? 'Mesh written and verified from EEPROM.' : 'Mesh write could not be fully verified.',
      )
    } catch (error) {
      report(error)
      setWrite({ phase: 'idle' })
      return
    }

    // Separate from the write, and after the result is on screen: this lifts the
    // head, so it needs homing behind it — reachable now that a reload comes
    // back connected and a restored session can be complete on arrival. A
    // failure here must not throw away the verdict on a write that succeeded.
    try {
      await ensureHomed()
      await runStep(buildFinishStep(profile, bilinear))
    } catch (error) {
      report(error)
    }
  }, [live, profile, runStep, runQuery, appendLog, keepDraft, ensureHomed, write, report])

  return {
    live,
    homed: isHomed,
    prep,
    gridVerified,
    hot,
    cold,
    busy,
    activity,
    home,
    prepare,
    goToPoint,
    next,
    previous,
    nudge,
    setZ,
    capture,
    loadFromPrinter,
    drafts,
    refreshDrafts,
    saveDraftNow,
    restoreDraft,
    removeDraft,
    reset,
    write,
    openReview,
    closeReview,
    confirmWrite,
  }
}

export type Leveling = ReturnType<typeof useLeveling>
