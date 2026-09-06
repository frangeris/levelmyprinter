import { create } from 'zustand'
import type { PrinterProfile, Vec3 } from '../printers/types.ts'
import { DEFAULT_PRINTER_ID, getPrinter, PRINTERS } from '../printers/registry.ts'
import { authorizedPorts, requestPort, SerialConnection } from '../serial/connect.ts'
import { CommandQueue } from '../serial/commandQueue.ts'
import type { ParsedLine, Temperatures } from '../serial/protocol.ts'
import { parseLine } from '../serial/protocol.ts'
import { autoReportTemperatures, reportTemperatures } from '../printer/gcodeBuilders.ts'
import type { CommandStep } from '../features/leveling/sequences.ts'
import { detectPrinter, type DetectedPrinter } from '../printer/discovery.ts'
import { deriveProfile } from '../printers/derive.ts'
import { saveOverride } from './profileOverrides.ts'
import { rememberPinnedGrid } from './pinnedGrids.ts'
import type { Vec2 } from '../printers/types.ts'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

export type LogDirection = 'out' | 'in' | 'info' | 'error'

export interface LogEntry {
  id: number
  at: number
  direction: LogDirection
  text: string
}

/** The log is a debug aid: capped so a long session does not eat memory. */
const MAX_LOG_ENTRIES = 2000

// Deliberately outside the store: these are not reactive state, and Web Serial
// allows a single reader per port — there must be exactly one instance.
let connection: SerialConnection | null = null
let queue: CommandQueue | null = null

let nextLogId = 0

/** Fallback poll timer, when the firmware will not report on its own. */
let sensorTimer: ReturnType<typeof setInterval> | null = null
/** When a temperature last arrived, from any source. */
let lastReadingAt = 0
/** True while our own `M105` is in flight, so its reply stays out of the log. */
let polling = false

interface PrinterState {
  printerId: string
  profile: PrinterProfile
  status: ConnectionStatus
  log: LogEntry[]
  temperatures: Temperatures | null
  position: Vec3 | null
  /** Description of the operation in progress, or `null` when idle. */
  busy: string | null
  /**
   * The same, but only for steps worth putting on screen.
   *
   * Split from `busy` because they answer different questions: `busy` gates the
   * controls and has to be true for every command, while this drives a
   * full-width strip whose appearance moves the page.
   */
  activity: string | null
  /**
   * Whether this connection came back on its own rather than through the
   * picker — a page reload, not someone sitting down to start.
   */
  restored: boolean
  /** What the printer said about itself on connect. `null` until it answers. */
  detected: DetectedPrinter | null
  /**
   * The connection checklist, in the order it runs.
   *
   * Empty while disconnected. Every entry is one thing the app has to establish
   * before it can drive this machine, and each is answered by a command rather
   * than by a constant — which is why they are worth showing rather than
   * assuming.
   */
  checks: ConnectionCheck[]

  /** Runs a sequence and fails hard if any command reports an error. */
  runStep: (step: CommandStep) => Promise<void>
  /** Runs a single-command step and returns its raw response text. */
  runQuery: (step: CommandStep) => Promise<string>
  connect: () => Promise<void>
  /** Reopens a port this origin was already granted, with no user gesture. */
  restore: () => Promise<void>
  /** Overrules the guessed grid bounds, for this machine, permanently. */
  setGridBounds: (min: Vec2, max: Vec2, key: string) => void
  disconnect: () => Promise<void>
  send: (command: string) => Promise<void>
  appendLog: (direction: LogDirection, text: string) => void
}

/**
 * Picks temperature and position readings out of **every** incoming line.
 *
 * Not just the unsolicited ones: while a blocking `M109`/`M190` waits, Marlin's
 * periodic temperature reports belong to the command in flight. Those are
 * exactly the minutes when someone needs to watch the number climb, so they
 * cannot be the ones we ignore.
 */
function readSensors(
  parsed: ParsedLine,
  set: (partial: Partial<Pick<PrinterState, 'temperatures' | 'position'>>) => void,
): void {
  const temperatures =
    parsed.kind === 'temperature'
      ? parsed.temperatures
      : parsed.kind === 'ok'
        ? parsed.temperatures
        : undefined

  if (temperatures) {
    lastReadingAt = Date.now()
    set({ temperatures })
  } else if (parsed.kind === 'position') {
    set({ position: parsed.position })
  }
}

/**
 * Whether a line is a sensor reading and nothing else.
 *
 * Those arrive every couple of seconds for as long as the printer is plugged
 * in. The header shows them live, so putting them in the log as well would push
 * everything worth reading out of a 2000-entry buffer within the hour. The
 * reply to an `M105` someone typed themselves is still conversation and stays.
 */
function isTelemetry(parsed: ParsedLine): boolean {
  return parsed.kind === 'temperature' || (polling && parsed.kind === 'ok')
}

const initialProfile = getPrinter(DEFAULT_PRINTER_ID) ?? PRINTERS[0]!

export type CheckId = 'printer' | 'travel' | 'leveling' | 'points'
export type CheckStatus = 'pending' | 'running' | 'ok' | 'failed'

/** One line of the connection checklist. */
export interface ConnectionCheck {
  id: CheckId
  label: string
  status: CheckStatus
  /** What was found, once it was. */
  detail: string | null
}

/**
 * Read-only, in this order: identity, motion limits, then everything the
 * firmware will serialise about itself — which is where the mesh, the steps per
 * mm and the feedrate ceilings come from.
 *
 * `M115` is asked on its own, ahead of the rest: it is what proves the baud
 * rate, and asking the other two at a rate that turns out to be wrong is just
 * more garbage to throw away. Everything after it runs with the connection
 * announced, so the answers arrive where someone can watch them.
 */
const INTERVIEW: { command: string; answers: CheckId[] }[] = [
  { command: 'M115', answers: ['printer'] },
  { command: 'M211', answers: ['travel'] },
  { command: 'M503', answers: ['leveling', 'points'] },
]

const CHECK_LABELS: Record<CheckId, string> = {
  printer: 'Printer',
  travel: 'Motion limits',
  leveling: 'Leveling system',
  points: 'Leveling points',
}

const LEVELING_LABELS: Record<string, string> = {
  bilinear: 'ABL Bilinear',
  ubl: 'Unified Bed Leveling',
  mbl: 'Mesh Bed Leveling',
  klipper: 'Klipper',
}

/**
 * What one check concluded from everything the printer has said so far.
 *
 * Failure here is never fatal on its own — a firmware that will not report its
 * travel limits still homes and still moves. It is stated rather than hidden
 * because the app then works from a fallback, and a fallback presented as a
 * reading is how someone ends up trusting a number nobody measured.
 */
function readCheck(
  id: CheckId,
  detected: DetectedPrinter,
): Pick<ConnectionCheck, 'status' | 'detail'> {
  switch (id) {
    case 'printer':
      return detected.firmware
        ? {
            status: 'ok',
            detail: [detected.machine, detected.firmware].filter(Boolean).join(' · '),
          }
        : { status: 'failed', detail: 'did not introduce itself' }

    case 'travel': {
      const travel = detected.travel
      return travel
        ? {
            status: 'ok',
            detail: `X ${travel.min.x}…${travel.max.x} · Y ${travel.min.y}…${travel.max.y} · Z ${travel.min.z}…${travel.max.z}`,
          }
        : { status: 'failed', detail: 'not reported — using the profile' }
    }

    case 'leveling':
      if (!detected.leveling) return { status: 'failed', detail: 'not reported' }
      return {
        status: detected.leveling === 'bilinear' ? 'ok' : 'failed',
        detail: LEVELING_LABELS[detected.leveling] ?? detected.leveling,
      }

    case 'points': {
      const count = detected.meshPoints.length
      const grid = detected.mesh
      // Counted off the `G29 W I.. J..` lines M503 replays: which points exist
      // is the machine's own list, not something worked out from a model name.
      return count > 0
        ? {
            status: 'ok',
            detail: grid ? `${count} points · ${grid.cols} × ${grid.rows}` : `${count} points`,
          }
        : { status: 'failed', detail: 'none stored — the bed has never been probed' }
    }
  }
}

const freshChecks = (): ConnectionCheck[] =>
  INTERVIEW.flatMap((step) => step.answers).map((id) => ({
    id,
    label: CHECK_LABELS[id],
    status: 'pending' as const,
    detail: null,
  }))

/** True once nothing is still being asked. */
export function checksSettled(checks: ConnectionCheck[]): boolean {
  return (
    checks.length > 0 &&
    checks.every((check) => check.status !== 'pending' && check.status !== 'running')
  )
}

/**
 * Tried in order until one answers. The printer cannot be asked what rate it
 * speaks — you have to already be speaking it — so the only way to find out is
 * to open, say something, and see whether the reply parses.
 *
 * The rate that worked is remembered, so the guessing happens once.
 */
const BAUD_RATES = [115200, 250000, 57600, 19200, 38400, 9600]
const BAUD_KEY = 'lmp.baud'

/**
 * How often the temperature readout refreshes.
 *
 * It is not decoration: the Save button is gated on the printer being at
 * temperature, so a stale reading is a button that stays wrong. Two seconds is
 * fast enough to watch a heat-up and slow enough to be free.
 */
const SENSOR_PERIOD_S = 2
/** Nothing heard for this long means the firmware is not reporting on its own. */
const SENSOR_STALE_MS = SENSOR_PERIOD_S * 1000 * 2.5

function rememberedBaud(): number | null {
  try {
    const stored = Number(localStorage?.getItem(BAUD_KEY))
    return Number.isFinite(stored) && stored > 0 ? stored : null
  } catch {
    return null
  }
}

function rememberBaud(rate: number): void {
  try {
    localStorage?.setItem(BAUD_KEY, String(rate))
  } catch {
    // Storage disabled. The only cost is guessing again next time.
  }
}

/** Remembered first, then the profile's, then the rest — each tried once. */
function baudOrder(profileRate: number): number[] {
  return [...new Set([rememberedBaud(), profileRate, ...BAUD_RATES].filter(Boolean) as number[])]
}

export const usePrinterStore = create<PrinterState>((set, get) => {
  /**
   * Asks one question and hands back everything it said.
   *
   * Deliberately not `runQuery`: the interview runs before and around the
   * connection being announced, so it must not touch `busy` and must not throw
   * a failed check into the error path.
   */
  const askOne = async (command: string): Promise<string | null> => {
    if (!queue) return null
    try {
      get().appendLog('out', command)
      return (await queue.enqueue(command)).lines.join('\n')
    } catch {
      // A question the printer will not answer is a failed check, not a failed
      // connection: the machine still homes and still moves.
      return null
    }
  }

  /**
   * The rest of the interview, run before the connection is announced.
   *
   * Deliberately not published step by step. The printer answers in
   * milliseconds, so a UI that opened on `M115` and then filled itself in would
   * not be showing progress — it would be showing a flicker. Nothing renders
   * until every answer is in, and then it renders once.
   *
   * Each answer is folded into the same transcript and re-read whole, so the
   * profile is rebuilt from everything known rather than patched field by field.
   */
  const interview = async (identity: string, rate: number, fallback: PrinterProfile) => {
    let transcript = identity

    for (const step of INTERVIEW.slice(1)) {
      const reply = await askOne(step.command)
      if (reply !== null) transcript += `\n${reply}`
    }

    const detected = detectPrinter(transcript)
    return {
      detected,
      profile: deriveProfile(detected, rate, fallback),
      checks: freshChecks().map((check) => ({ ...check, ...readCheck(check.id, detected) })),
    }
  }

  const stopSensorReports = (): void => {
    if (sensorTimer !== null) clearInterval(sensorTimer)
    sensorTimer = null
    polling = false
    lastReadingAt = 0
  }

  /**
   * Keeps the temperature readout alive for as long as the printer is plugged
   * in.
   *
   * Preferred route is the firmware reporting on its own: nothing has to be
   * asked, so nothing of ours ever sits in the queue ahead of a move. The timer
   * is the fallback, and it fires only when nothing has arrived by itself —
   * which makes it a safety net rather than a second source, whether `M155`
   * was honoured, ignored, or never sent.
   */
  const startSensorReports = (detected: DetectedPrinter): void => {
    stopSensorReports()
    if (!queue) return

    if (detected.capabilities.AUTOREPORT_TEMP) {
      const command = autoReportTemperatures(SENSOR_PERIOD_S)
      get().appendLog('out', command)
      void queue.enqueue(command).catch(() => undefined)
    }

    sensorTimer = setInterval(() => {
      if (!queue || polling) return
      if (Date.now() - lastReadingAt < SENSOR_STALE_MS) return
      // Never ahead of real work: the queue is strictly sequential, so a poll
      // queued behind a `G29` would wait minutes and land stale anyway.
      if (queue.pending > 0) return

      polling = true
      void queue
        .enqueue(reportTemperatures())
        .catch(() => undefined)
        .finally(() => {
          polling = false
        })
    }, SENSOR_PERIOD_S * 1000)
  }

  /**
   * The one place a port gets opened, shared by the picker and by the silent
   * reconnect: everything except *which* port is identical, and a second copy
   * of the wiring is a second place for the reader and the queue to drift.
   */
  const open = async (pick: () => Promise<SerialPort>, restored: boolean): Promise<void> => {
    if (get().status !== 'disconnected') return
    set({ status: 'connecting' })

    const { appendLog } = get()

    let port: SerialPort
    try {
      port = await pick()
    } catch (error) {
      set({ status: 'disconnected', restored: false })
      const message = error instanceof Error ? error.message : String(error)
      // Dismissing the browser dialog is not an error worth reporting.
      if (!/No port selected|cancel/i.test(message)) appendLog('error', message)
      return
    }

    let lastError = 'The printer did not answer at any baud rate.'

    for (const rate of baudOrder(get().profile.baudRate)) {
      connection = new SerialConnection({
        onLine: (line) => {
          const parsed = parseLine(line)
          if (!isTelemetry(parsed)) appendLog('in', line)
          readSensors(parsed, set)
          queue?.handleLine(line)
        },
        onDisconnect: (reason) => {
          appendLog('error', reason)
          queue?.clear(reason)
          void get().disconnect()
        },
      })
      queue = new CommandQueue((line) => connection!.write(line))

      try {
        await connection.openPort(port, rate)
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        connection = null
        queue = null
        continue
      }

      // Read-only, and the one question that has to be asked at every candidate
      // rate: a wrong rate does not fail to open, it delivers garbage, and
      // recognisable firmware is the only proof the two ends understand each
      // other.
      const identity = (await askOne(INTERVIEW[0]!.command)) ?? ''
      const detected = detectPrinter(identity)

      if (detected.firmware) {
        rememberBaud(rate)
        // The machine's own account of itself replaces the guess we opened
        // with. A hand-written profile still supplies what it will not report.
        const answers = await interview(identity, rate, get().profile)
        set({
          status: 'connected',
          restored,
          printerId: answers.profile.id,
          ...answers,
        })
        appendLog(
          'info',
          `${restored ? 'Reconnected to' : 'Connected to'} ${answers.profile.label} @ ${rate} baud`,
        )
        if (restored) appendLog('info', 'It will home before the first move.')
        startSensorReports(answers.detected)
        return
      }

      appendLog('info', `No answer at ${rate} baud.`)
      await connection.close()
      connection = null
      queue = null
    }

    set({ status: 'disconnected', restored: false, detected: null, checks: [] })
    appendLog('error', lastError)
  }

  return {
    printerId: initialProfile.id,
    profile: initialProfile,
    status: 'disconnected',
    log: [],
    temperatures: null,
    position: null,
    busy: null,
    activity: null,
    restored: false,
    detected: null,
    checks: [],

    appendLog: (direction, text) =>
      set((state) => {
        const entry: LogEntry = { id: nextLogId++, at: Date.now(), direction, text }
        const log = [...state.log, entry]
        return { log: log.length > MAX_LOG_ENTRIES ? log.slice(-MAX_LOG_ENTRIES) : log }
      }),

    connect: () => open(requestPort, false),

    /**
     * Comes back after a reload without asking anything.
     *
     * Chrome remembers the port grant per origin, so a reload does not need the
     * picker again — the old behaviour, showing a connect dialog over a printer
     * that is plainly still plugged in, was the app forgetting, not the browser.
     *
     * Only when exactly one port is authorized: with several there is no way to
     * tell which one is the printer, and guessing would open the wrong device.
     */
    restore: async () => {
      if (get().status !== 'disconnected') return

      let ports: SerialPort[] = []
      try {
        ports = await authorizedPorts()
      } catch {
        return
      }

      const port = ports.length === 1 ? ports[0] : undefined
      if (!port) return

      await open(() => Promise.resolve(port), true)
    },

    setGridBounds: (min, max, key) => {
      saveOverride(key, min, max)
      // Rebuilt rather than patched: the bounds feed the spacing, which feeds
      // every point position, and half-updating that is how a mesh ends up
      // drawn in one place and written to another.
      const { profile } = get()
      const updated = { ...profile, mesh: { ...profile.mesh, min, max } }
      set({ profile: updated })
      // Typing the bounds is the other way of knowing them: someone who ran the
      // auto-level from a different machine has the numbers, and the app has no
      // record because the record lives in this browser. Stating them counts —
      // it is the same claim the `G29` makes, on a person's authority instead.
      rememberPinnedGrid(key, updated, Date.now(), 'stated')
    },

    disconnect: async () => {
      // Auto-reporting is deliberately not turned off: the port is closing, so
      // the reports go nowhere, and the next connect sets the period again.
      stopSensorReports()
      queue?.clear('Disconnected')
      queue = null
      const active = connection
      connection = null
      await active?.close()
      set({
        status: 'disconnected',
        restored: false,
        detected: null,
        checks: [],
        temperatures: null,
        position: null,
        busy: null,
        activity: null,
      })
      get().appendLog('info', 'Disconnected')
    },

    runStep: async (step) => {
      if (!queue) throw new Error('No connection to the printer.')
      set({ busy: step.label, activity: step.quiet ? null : step.label })
      try {
        for (const command of step.commands) {
          get().appendLog('out', command)
          const result = await queue.enqueue(command, {
            ...(step.idleTimeoutMs !== undefined && { idleTimeoutMs: step.idleTimeoutMs }),
          })
          // Swallowing this is not an option: moving the machine after a command
          // failed is exactly how a nozzle ends up driven into the glass.
          if (result.error) throw new Error(`${command}: ${result.error}`)
        }
      } finally {
        set({ busy: null, activity: null })
      }
    },

    runQuery: async (step) => {
      if (!queue) throw new Error('No connection to the printer.')
      const command = step.commands[0]
      if (step.commands.length !== 1 || command === undefined) {
        throw new Error('runQuery expects exactly one command.')
      }
      set({ busy: step.label, activity: step.quiet ? null : step.label })
      try {
        get().appendLog('out', command)
        const result = await queue.enqueue(command, {
          ...(step.idleTimeoutMs !== undefined && { idleTimeoutMs: step.idleTimeoutMs }),
        })
        if (result.error) throw new Error(`${command}: ${result.error}`)
        return result.lines.join('\n')
      } finally {
        set({ busy: null, activity: null })
      }
    },

    send: async (command) => {
      const trimmed = command.trim()
      if (!trimmed || !queue) return

      get().appendLog('out', trimmed)
      try {
        const result = await queue.enqueue(trimmed)
        if (result.error) get().appendLog('error', result.error)
      } catch (error) {
        get().appendLog('error', error instanceof Error ? error.message : String(error))
      }
    },
  }
})
