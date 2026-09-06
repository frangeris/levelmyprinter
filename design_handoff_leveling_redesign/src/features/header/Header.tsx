import { PRINTERS } from '../../printers/registry.ts'
import { usePrinterStore } from '../../state/printerStore.ts'

interface HeaderProps {
  onPreheat: () => void
  onStatusClick: () => void
}

/**
 * One row: the printer, the live readouts centred, and the single action.
 *
 * The status light replaced the "Connected" label and the Disconnect button:
 * a lit dot already says connected, and clicking it is how you get out. Saying
 * it twice and offering a button next to it was noise.
 */
export function Header({ onPreheat, onStatusClick }: HeaderProps) {
  const printerId = usePrinterStore((s) => s.printerId)
  const status = usePrinterStore((s) => s.status)
  const temperatures = usePrinterStore((s) => s.temperatures)
  const position = usePrinterStore((s) => s.position)
  const selectPrinter = usePrinterStore((s) => s.selectPrinter)

  const connected = status === 'connected'

  return (
    <header className="header">
      <div className="header__printer">
        <button
          type="button"
          className={`header__dot${connected ? ' header__dot--live' : ''}`}
          onClick={onStatusClick}
          aria-label={connected ? 'Connected — disconnect' : 'Not connected'}
          title={connected ? 'Connected — click to disconnect' : 'Not connected'}
        />
        {/* The model is a select rather than a label: it is the one thing you
            pick before connecting, and it reads as the page's title. */}
        <select
          className="header__select"
          value={printerId}
          onChange={(event) => selectPrinter(event.target.value)}
          disabled={connected}
        >
          {PRINTERS.map((printer) => (
            <option key={printer.id} value={printer.id}>
              {printer.label}
            </option>
          ))}
        </select>
      </div>

      <div className="header__readout">
        {temperatures?.nozzle && (
          <span>
            Nozzle <b>{temperatures.nozzle.current.toFixed(1)}°</b> /{' '}
            {temperatures.nozzle.target.toFixed(0)}°
          </span>
        )}
        {temperatures?.bed && (
          <span>
            Bed <b>{temperatures.bed.current.toFixed(1)}°</b> / {temperatures.bed.target.toFixed(0)}°
          </span>
        )}
        {position && (
          <>
            <span>X <b>{position.x.toFixed(1)}</b></span>
            <span>Y <b>{position.y.toFixed(1)}</b></span>
            <span>Z <b>{position.z.toFixed(2)}</b></span>
          </>
        )}
      </div>

      <button type="button" className="btn btn--outline" onClick={onPreheat} disabled={!connected}>
        Preheat
      </button>
    </header>
  )
}
