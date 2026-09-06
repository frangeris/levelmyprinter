import { useEffect, useRef, useState } from 'react'
import { usePrinterStore } from '../../state/printerStore.ts'
import { Button } from '../../ui/Button.tsx'
import { Dialog, DialogActions, DialogSpacer, INPUT, Note } from '../../ui/Dialog.tsx'

/** Log ink, by where the line came from. */
const LINE: Record<string, string> = {
  out: 'text-accent-ink',
  in: 'text-ink',
  info: 'text-ok',
  error: 'text-warn-ink',
}

/** Read-only commands: they neither move the machine nor write to EEPROM. */
const QUICK_COMMANDS: [string, string][] = [
  ['M115', 'Firmware and machine name'],
  ['M503', 'Dump the whole configuration'],
  ['M211', 'Software endstop limits'],
  ['M114', 'Current position'],
  ['M105', 'Nozzle and bed temperatures'],
  ['M420 V1', 'Report the stored mesh'],
]

/**
 * The log, collapsed by default and parked at the bottom of the controls
 * column: it is a diagnostic, not the job.
 *
 * Timestamps are gone (they told you nothing about a pass done by hand) and so
 * is the row of quick-command buttons — the "?" carries them, with a line
 * saying what each one is for.
 */
export function Terminal() {
  const log = usePrinterStore((s) => s.log)
  const status = usePrinterStore((s) => s.status)
  const send = usePrinterStore((s) => s.send)

  const [open, setOpen] = useState(false)
  const [help, setHelp] = useState(false)
  const [draft, setDraft] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const connected = status === 'connected'

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log, open])

  /**
   * Sends one command, or a whole block of them in order.
   *
   * A block matters more than it looks: a mesh is 25 lines, so backing one up is
   * copying them out of the log and restoring it is pasting them back — as
   * `M421`, because the `G29 W` that `M503` prints clears the grid on every
   * call. One line at a time would make that a chore nobody would do.
   */
  const submit = (text: string) => {
    const commands = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (commands.length === 0 || !connected) return

    setHistory((h) => {
      const next = [...h]
      for (const command of commands) {
        if (next[next.length - 1] !== command) next.push(command)
      }
      return next
    })
    setHistoryIndex(null)
    setDraft('')

    void (async () => {
      // Awaited one by one so the log reads as a conversation rather than 25
      // outgoing lines followed by 25 replies.
      for (const command of commands) await send(command)
    })()
  }

  /** Up/down arrows walk the history, like any console. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    if (history.length === 0) return
    event.preventDefault()

    const next =
      event.key === 'ArrowUp'
        ? Math.max(0, (historyIndex ?? history.length) - 1)
        : historyIndex === null
          ? null
          : historyIndex + 1

    if (next === null || next >= history.length) {
      setHistoryIndex(null)
      setDraft('')
      return
    }
    setHistoryIndex(next)
    setDraft(history[next] ?? '')
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col pt-4">
      <div className="flex shrink-0 items-baseline gap-2">
        <button
          type="button"
          className="group flex cursor-pointer items-baseline gap-[7px] font-semibold tracking-[0.08em] text-n-600 uppercase"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="inline-block -rotate-90 group-aria-expanded:rotate-0">▼</span>Terminal
        </button>
        <button
          type="button"
          className="h-[20px] w-[20px] shrink-0 cursor-pointer rounded-full border border-divider p-0 leading-none font-semibold text-accent-ink"
          onClick={() => setHelp(true)}
          aria-label="Common commands"
        >
          ?
        </button>
      </div>

      {open && (
        <>
          <div
            className="mt-2 min-h-[80px] flex-1 overflow-y-auto font-mono leading-[1.6]"
            ref={logRef}
          >
            {log.map((entry) => (
              <p
                key={entry.id}
                className={`${LINE[entry.direction] ?? ''} m-0 break-words whitespace-pre-wrap`}
              >
                {entry.direction === 'out' ? '> ' : ''}
                {entry.text}
              </p>
            ))}
          </div>
          <form
            className="mt-2 shrink-0"
            onSubmit={(event) => {
              event.preventDefault()
              submit(draft)
            }}
          >
            {/* No Send button: typing and pressing Enter is the whole gesture. */}
            <input
              className={`${INPUT} font-mono`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={(event) => {
                // An <input> flattens a multi-line paste into one line, so the
                // block has to be taken from the clipboard before that happens.
                const text = event.clipboardData.getData('text')
                if (!text.includes('\n')) return
                event.preventDefault()
                submit(text)
              }}
              placeholder={connected ? 'G-code command, then Enter' : 'Connect the printer first'}
              disabled={!connected}
              spellCheck={false}
              autoComplete="off"
              aria-label="G-code command"
            />
          </form>
        </>
      )}

      {help && (
        <Dialog labelledBy="help-title" className="w-[min(480px,100%)]">
          <h2 id="help-title" className="text-title">
            Common commands
          </h2>
          <p className="leading-[1.6]">
            Read-only: they neither move the machine nor write to EEPROM. Click one to send it.
          </p>
          <Note>
            Pasting several lines into the box sends them in order. To back a mesh up:{' '}
            <code className="font-mono">M503</code> and keep the{' '}
            <code className="font-mono">G29 W</code> lines. To put it back, change each one to{' '}
            <code className="font-mono">M421</code> and follow with{' '}
            <code className="font-mono">M500</code> — pasting them back as{' '}
            <code className="font-mono">G29 W</code> would wipe the grid, one point per line.
          </Note>
          <div className="flex flex-col">
            {QUICK_COMMANDS.map(([command, what]) => (
              <button
                key={command}
                type="button"
                className="flex cursor-pointer items-baseline gap-3 border-b border-divider px-[2px] py-2 text-left text-ink hover:bg-accent/8 disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!connected}
                onClick={() => {
                  submit(command)
                  setHelp(false)
                  setOpen(true)
                }}
              >
                <code className="w-[82px] shrink-0 font-mono text-accent-ink">{command}</code>
                <span>{what}</span>
              </button>
            ))}
          </div>
          <DialogActions>
            <DialogSpacer />
            <Button onClick={() => setHelp(false)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}
    </section>
  )
}
