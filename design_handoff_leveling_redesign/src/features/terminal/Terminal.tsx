import { useEffect, useRef, useState } from 'react'
import { usePrinterStore } from '../../state/printerStore.ts'

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

  const submit = (command: string) => {
    const trimmed = command.trim()
    if (!trimmed || !connected) return
    setHistory((h) => (h[h.length - 1] === trimmed ? h : [...h, trimmed]))
    setHistoryIndex(null)
    setDraft('')
    void send(trimmed)
  }

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
    <section className="terminal">
      <div className="terminal__bar">
        <button type="button" className="terminal__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="terminal__caret">▼</span>Terminal
        </button>
        <button type="button" className="terminal__help" onClick={() => setHelp(true)} aria-label="Common commands">
          ?
        </button>
      </div>

      {open && (
        <>
          <div className="terminal__log" ref={logRef}>
            {log.map((entry) => (
              <p key={entry.id} className={`line--${entry.direction}`}>
                {entry.direction === 'out' ? '> ' : ''}
                {entry.text}
              </p>
            ))}
          </div>
          <form
            className="terminal__form"
            onSubmit={(event) => {
              event.preventDefault()
              submit(draft)
            }}
          >
            {/* No Send button: typing and pressing Enter is the whole gesture. */}
            <input
              className="input input--mono"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={connected ? 'G-code command, then Enter' : 'Connect the printer first'}
              disabled={!connected}
              spellCheck={false}
              autoComplete="off"
            />
          </form>
        </>
      )}

      {help && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true">
          <div className="dialog" style={{ width: 'min(480px, 100%)' }}>
            <h2>Common commands</h2>
            <p>Read-only: they neither move the machine nor write to EEPROM. Click one to send it.</p>
            <div className="help-list">
              {QUICK_COMMANDS.map(([command, what]) => (
                <button
                  key={command}
                  type="button"
                  disabled={!connected}
                  onClick={() => {
                    submit(command)
                    setHelp(false)
                    setOpen(true)
                  }}
                >
                  <code>{command}</code>
                  <span>{what}</span>
                </button>
              ))}
            </div>
            <div className="dialog__actions">
              <div className="dialog__spacer" />
              <button type="button" className="btn btn--outline" onClick={() => setHelp(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
