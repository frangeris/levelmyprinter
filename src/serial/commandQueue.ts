import { isProgress, isTerminal, parseLine, type ParsedLine } from './protocol.ts'

export interface CommandOptions {
  /**
   * ms without receiving ANYTHING from the printer before aborting.
   *
   * This is an *idle* timeout, not a total-duration one: any incoming line
   * resets it. Without that, a `G29` running for minutes would look hung, when
   * in fact it is emitting `Taring probe` the whole time.
   */
  idleTimeoutMs?: number
}

export interface CommandResult {
  command: string
  lines: string[]
  parsed: ParsedLine[]
  /** First `Error:` received, if any. The command still ended with `ok`. */
  error?: string
}

interface Job extends Required<CommandOptions> {
  command: string
  resolve: (result: CommandResult) => void
  reject: (error: Error) => void
  lines: string[]
  parsed: ParsedLine[]
  error?: string
  timer?: ReturnType<typeof setTimeout>
}

const DEFAULT_IDLE_TIMEOUT_MS = 10_000

/**
 * Strictly sequential FIFO queue.
 *
 * Marlin processes one command at a time and the board's buffer is small: the
 * **real** `ok` has to be awaited before sending the next one, never assumed.
 */
export class CommandQueue {
  private queue: Job[] = []
  private current: Job | null = null

  constructor(
    private readonly send: (line: string) => Promise<void>,
    /** Lines arriving with no command in flight (temperature autoreport, etc.). */
    private readonly onUnsolicited?: (parsed: ParsedLine) => void,
  ) {}

  get pending(): number {
    return this.queue.length + (this.current ? 1 : 0)
  }

  get inFlight(): string | null {
    return this.current?.command ?? null
  }

  enqueue(command: string, options: CommandOptions = {}): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      this.queue.push({
        command,
        idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
        resolve,
        reject,
        lines: [],
        parsed: [],
      })
      void this.pump()
    })
  }

  /** Queues several commands and waits for all of them, in order. */
  async enqueueAll(commands: string[], options: CommandOptions = {}): Promise<CommandResult[]> {
    const results: CommandResult[] = []
    for (const command of commands) {
      results.push(await this.enqueue(command, options))
    }
    return results
  }

  /** Fed by the serial connection, one call per received line. */
  handleLine(raw: string): void {
    const parsed = parseLine(raw)
    const job = this.current

    if (!job) {
      this.onUnsolicited?.(parsed)
      return
    }

    job.lines.push(raw)
    job.parsed.push(parsed)

    if (parsed.kind === 'error' && job.error === undefined) {
      job.error = parsed.message
    }

    if (isTerminal(parsed)) {
      this.finish(job)
      return
    }

    if (isProgress(parsed) || parsed.kind === 'echo') {
      this.armTimer(job)
    }
  }

  /** Rejects everything outstanding. For disconnects or user cancellation. */
  clear(reason = 'Queue cancelled'): void {
    const error = new Error(reason)
    if (this.current?.timer) clearTimeout(this.current.timer)
    this.current?.reject(error)
    this.current = null
    for (const job of this.queue) job.reject(error)
    this.queue = []
  }

  private async pump(): Promise<void> {
    if (this.current) return
    const job = this.queue.shift()
    if (!job) return

    this.current = job
    this.armTimer(job)

    try {
      await this.send(job.command)
    } catch (cause) {
      if (job.timer) clearTimeout(job.timer)
      this.current = null
      job.reject(new Error(`Could not send "${job.command}"`, { cause }))
      void this.pump()
    }
  }

  private armTimer(job: Job): void {
    if (job.timer) clearTimeout(job.timer)
    job.timer = setTimeout(() => {
      if (this.current !== job) return
      this.current = null
      job.reject(
        new Error(
          `"${job.command}" did not respond within ${job.idleTimeoutMs} ms. ` +
            'The printer may be busy or disconnected.',
        ),
      )
      void this.pump()
    }, job.idleTimeoutMs)
  }

  private finish(job: Job): void {
    if (job.timer) clearTimeout(job.timer)
    this.current = null
    job.resolve({
      command: job.command,
      lines: job.lines,
      parsed: job.parsed,
      ...(job.error !== undefined && { error: job.error }),
    })
    void this.pump()
  }
}
