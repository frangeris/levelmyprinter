import type { Vec3 } from '../printers/types.ts'

export interface HeaterReading {
  current: number
  target: number
}

export interface Temperatures {
  nozzle?: HeaterReading
  bed?: HeaterReading
}

export type ParsedLine =
  /** Marlin finished the previous command. Clears the next one to be sent. */
  | { kind: 'ok'; raw: string; temperatures?: Temperatures }
  | { kind: 'echo'; raw: string; text: string }
  /** Still working. Not a response, but proof the port is alive. */
  | { kind: 'busy'; raw: string }
  | { kind: 'wait'; raw: string }
  | { kind: 'error'; raw: string; message: string }
  | { kind: 'resend'; raw: string; line: number }
  | { kind: 'temperature'; raw: string; temperatures: Temperatures }
  | { kind: 'position'; raw: string; position: Vec3 }
  | { kind: 'data'; raw: string }

/** `T:23.98 /0.00 B:24.37 /0.00` → nozzle and bed readings. */
export function parseTemperatures(line: string): Temperatures | undefined {
  const read = (prefix: string): HeaterReading | undefined => {
    const m = new RegExp(`${prefix}:\\s*(-?\\d+\\.?\\d*)\\s*/\\s*(-?\\d+\\.?\\d*)`).exec(line)
    if (!m || m[1] === undefined || m[2] === undefined) return undefined
    return { current: Number(m[1]), target: Number(m[2]) }
  }

  const nozzle = read('T')
  const bed = read('B')
  if (!nozzle && !bed) return undefined
  return { ...(nozzle && { nozzle }), ...(bed && { bed }) }
}

/** `X:0.00 Y:0.00 Z:0.00 E:0.00 Count ...` → the position M114 reports. */
export function parsePosition(line: string): Vec3 | undefined {
  const m = /X:\s*(-?\d+\.?\d*)\s+Y:\s*(-?\d+\.?\d*)\s+Z:\s*(-?\d+\.?\d*)/.exec(line)
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) return undefined
  return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) }
}

export function parseLine(raw: string): ParsedLine {
  const line = raw.trim()

  if (line === 'wait') return { kind: 'wait', raw }

  if (line.startsWith('busy:')) return { kind: 'busy', raw }

  if (/^(Error|error|!!)/.test(line)) {
    return { kind: 'error', raw, message: line.replace(/^(Error|error):?\s*/, '') }
  }

  if (line.startsWith('Resend:')) {
    const n = Number(line.slice('Resend:'.length).trim())
    return { kind: 'resend', raw, line: Number.isFinite(n) ? n : -1 }
  }

  // `ok` arrives either bare or with temperatures attached (M105's answer).
  if (line === 'ok' || line.startsWith('ok ')) {
    const temperatures = parseTemperatures(line)
    return { kind: 'ok', raw, ...(temperatures && { temperatures }) }
  }

  if (line.startsWith('echo:')) {
    return { kind: 'echo', raw, text: line.slice('echo:'.length) }
  }

  const position = parsePosition(line)
  if (position) return { kind: 'position', raw, position }

  const temperatures = parseTemperatures(line)
  if (temperatures) return { kind: 'temperature', raw, temperatures }

  return { kind: 'data', raw }
}

/** Marks the end of a command's response: the queue may send the next one. */
export function isTerminal(parsed: ParsedLine): boolean {
  return parsed.kind === 'ok'
}

/**
 * Proof the printer is still alive even though it has not finished.
 * Resets the idle timeout — essential for long commands like `G29`, which can
 * run for minutes between one `ok` and the next.
 *
 * Temperature reports count. Once auto-reporting is on they are often the only
 * thing arriving during a long move, and a machine that is still telling us how
 * hot it is has plainly not gone away.
 */
export function isProgress(parsed: ParsedLine): boolean {
  return (
    parsed.kind === 'busy' ||
    parsed.kind === 'wait' ||
    parsed.kind === 'data' ||
    parsed.kind === 'temperature'
  )
}
