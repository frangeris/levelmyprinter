export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

/**
 * The browser's port picker, on its own.
 *
 * Separate from opening, because the baud rate is not known in advance and
 * finding it means opening the same port more than once — asking the user to
 * pick it again each time would be absurd.
 */
export async function requestPort(): Promise<SerialPort> {
  if (!isWebSerialSupported()) {
    throw new Error('This browser does not support Web Serial.')
  }
  return navigator.serial.requestPort()
}

/** Ports already authorized for this origin; Chrome remembers the grant. */
export async function authorizedPorts(): Promise<SerialPort[]> {
  if (!isWebSerialSupported()) return []
  return navigator.serial.getPorts()
}

export interface SerialConnectionHandlers {
  onLine: (line: string) => void
  onDisconnect?: (reason: string) => void
}

/**
 * Owner of the port and of the read loop.
 *
 * Web Serial allows a single active *reader* per port, so the whole app shares
 * this instance and nothing else touches `port.readable`.
 */
export class SerialConnection {
  private port: SerialPort | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private readLoop: Promise<void> | null = null
  private buffer = ''
  private closing = false

  private readonly encoder = new TextEncoder()

  constructor(private readonly handlers: SerialConnectionHandlers) {}

  get isOpen(): boolean {
    return this.port !== null
  }

  async openPort(port: SerialPort, baudRate: number): Promise<void> {
    if (this.port) throw new Error('A port is already open.')

    await port.open({ baudRate })
    if (!port.readable || !port.writable) {
      await port.close()
      throw new Error('The port opened without read/write streams.')
    }

    this.port = port
    this.closing = false
    this.buffer = ''
    this.reader = port.readable.getReader()
    this.writer = port.writable.getWriter()
    this.readLoop = this.runReadLoop()
  }

  /** Sends one line. Marlin expects `\n` as the terminator. */
  async write(line: string): Promise<void> {
    if (!this.writer) throw new Error('No open connection.')
    await this.writer.write(this.encoder.encode(`${line}\n`))
  }

  async close(): Promise<void> {
    if (!this.port) return
    this.closing = true

    try {
      await this.reader?.cancel()
    } catch {
      // The port may already be gone; either way we still release everything.
    }
    await this.readLoop

    this.reader?.releaseLock()
    this.writer?.releaseLock()
    this.reader = null
    this.writer = null
    this.readLoop = null

    try {
      await this.port.close()
    } catch {
      // idem
    }
    this.port = null
  }

  private async runReadLoop(): Promise<void> {
    const decoder = new TextDecoder()

    while (this.reader) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await this.reader.read()
      } catch (error) {
        if (!this.closing) {
          this.handlers.onDisconnect?.(
            error instanceof Error ? error.message : 'The connection was lost.',
          )
        }
        return
      }

      if (chunk.done) {
        if (!this.closing) this.handlers.onDisconnect?.('The printer closed the connection.')
        return
      }
      if (!chunk.value) continue

      this.buffer += decoder.decode(chunk.value, { stream: true })
      this.drainLines()
    }
  }

  private drainLines(): void {
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      if (line.length > 0) this.handlers.onLine(line)
      newline = this.buffer.indexOf('\n')
    }
  }
}
