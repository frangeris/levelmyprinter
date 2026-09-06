import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandQueue } from './commandQueue.ts'
import type { ParsedLine } from './protocol.ts'

const recorder = () => {
  const sent: string[] = []
  const queue = new CommandQueue(async (line) => {
    sent.push(line)
  })
  return { sent, queue }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('CommandQueue', () => {
  it('sends one command at a time and waits for ok before the next', () => {
    const { sent, queue } = recorder()

    queue.enqueue('G28')
    queue.enqueue('M114')
    expect(sent).toEqual(['G28'])

    queue.handleLine('ok')
    expect(sent).toEqual(['G28', 'M114'])
  })

  it('collects each command response lines', async () => {
    const { queue } = recorder()

    const result = queue.enqueue('M503')
    queue.handleLine('echo:  M420 S1 Z2.00')
    queue.handleLine('echo:  G29 W I0 J0 Z0.16250')
    queue.handleLine('ok')

    await expect(result).resolves.toMatchObject({
      command: 'M503',
      lines: ['echo:  M420 S1 Z2.00', 'echo:  G29 W I0 J0 Z0.16250', 'ok'],
    })
  })

  it('aborts when the printer stops responding', async () => {
    vi.useFakeTimers()
    const { queue } = recorder()

    const result = queue.enqueue('M114', { idleTimeoutMs: 1000 })
    vi.advanceTimersByTime(1001)

    await expect(result).rejects.toThrow(/did not respond/)
  })

  it('does not abort a long G29 as long as something keeps arriving', async () => {
    vi.useFakeTimers()
    const { queue } = recorder()

    const result = queue.enqueue('G29', { idleTimeoutMs: 1000 })

    // A real G29 takes minutes and only emits "Taring probe" between touches.
    // The timeout is idle-based, so every line resets it.
    for (let i = 0; i < 200; i++) {
      vi.advanceTimersByTime(900)
      queue.handleLine('Taring probe')
    }

    queue.handleLine('ok')
    await expect(result).resolves.toMatchObject({ command: 'G29' })
  })

  it('keeps a blocking heat-up alive on temperature reports alone', async () => {
    vi.useFakeTimers()
    const { queue } = recorder()

    // M190 blocks for minutes, and while it waits the only thing the printer
    // sends is how hot the bed is. Not counting that as proof of life would
    // abort every preheat from cold.
    const result = queue.enqueue('M190 S60', { idleTimeoutMs: 1000 })
    for (let i = 0; i < 200; i++) {
      vi.advanceTimersByTime(900)
      queue.handleLine(' T:24.31 /0.00 B:41.25 /60.00 @:0 B@:127')
    }

    queue.handleLine('ok')
    await expect(result).resolves.toMatchObject({ command: 'M190 S60' })
  })

  it('reports the error but still waits for the ok that follows it', async () => {
    const { queue } = recorder()

    const result = queue.enqueue('G30 X20 Y20')
    queue.handleLine('Error:Probing Failed')
    expect(queue.inFlight).toBe('G30 X20 Y20')

    queue.handleLine('ok')
    await expect(result).resolves.toMatchObject({ error: 'Probing Failed' })
  })

  it('rejects everything outstanding on disconnect', async () => {
    const { queue } = recorder()

    const first = queue.enqueue('G28')
    const second = queue.enqueue('M114')
    queue.clear('Disconnected')

    await expect(first).rejects.toThrow('Disconnected')
    await expect(second).rejects.toThrow('Disconnected')
    expect(queue.pending).toBe(0)
  })

  it('routes lines that arrive with no command in flight', () => {
    const unsolicited: ParsedLine[] = []
    const queue = new CommandQueue(
      async () => {},
      (parsed) => unsolicited.push(parsed),
    )

    // Temperature autoreport: it arrives on its own, unrequested.
    queue.handleLine('ok T:200.00 /200.00 B:60.00 /60.00')

    expect(unsolicited).toHaveLength(1)
    expect(unsolicited[0]?.kind).toBe('ok')
  })
})
