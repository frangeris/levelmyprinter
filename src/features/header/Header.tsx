import { usePrinterStore } from '../../state/printerStore.ts'
import type { HeaterReading } from '../../serial/protocol.ts'
import { coldHeaters, type HeaterName } from '../../printer/temperature.ts'
import { Button } from '../../ui/Button.tsx'

interface HeaderProps {
  onPreheat: () => void
  onStatusClick: () => void
  onOpenDetails: () => void
}

/** Every readout keeps its place whether or not there is a number for it. */
const DASH = '—'

function Temp({
  label,
  reading,
  ready,
}: {
  label: string
  reading?: HeaterReading
  ready: boolean
}) {
  return (
    <span className="whitespace-nowrap">
      {label}{' '}
      {reading ? (
        <>
          <b className={`font-semibold ${ready ? 'text-ok' : 'text-ink'}`}>
            {reading.current.toFixed(1)}°
          </b>
          {reading.target > 0 && ` / ${reading.target.toFixed(0)}°`}
        </>
      ) : (
        <b className="font-semibold text-ink">{DASH}</b>
      )}
    </span>
  )
}

function Axis({ label, value, digits }: { label: string; value?: number; digits: number }) {
  return (
    <span className="whitespace-nowrap">
      {label}{' '}
      <b className="font-semibold text-ink">{value === undefined ? DASH : value.toFixed(digits)}</b>
    </span>
  )
}

/**
 * One row: the printer, the live readouts centred, and the single action.
 *
 * The readouts are always drawn, dashes and all. They are not decoration —
 * saving a point is gated on the printer being at temperature — so the row has
 * to be a place you can look at, which means it cannot appear and disappear
 * with the readings. Dashes say "no reading yet"; an empty row said nothing.
 *
 * The status light replaced the "Connected" label and the Disconnect button:
 * a lit dot already says connected, and clicking it is how you get out.
 */
export function Header({ onPreheat, onStatusClick, onOpenDetails }: HeaderProps) {
  const profile = usePrinterStore((s) => s.profile)
  const status = usePrinterStore((s) => s.status)
  const temperatures = usePrinterStore((s) => s.temperatures)
  const position = usePrinterStore((s) => s.position)
  const connected = status === 'connected'

  const cold = coldHeaters(temperatures)
  const ready = (name: HeaterName) => !cold.includes(name)

  return (
    <header className="flex shrink-0 items-center gap-4 px-8 pt-4 pb-3 whitespace-nowrap">
      <div className="flex min-w-0 items-center gap-1">
        {/* Status is the affordance: clicking the live dot is how you disconnect. */}
        <button
          type="button"
          className={`h-[14px] w-[14px] shrink-0 cursor-pointer rounded-full border-none p-0 ${
            connected ? 'bg-ok' : 'bg-n-400'
          }`}
          onClick={onStatusClick}
          aria-label={connected ? 'Connected — disconnect' : 'Not connected'}
          title={connected ? 'Connected — click to disconnect' : 'Not connected'}
        />
        {/* Not a choice — this is what the machine said it is. Clicking it
            opens the rest of what it said, and where each part came from. */}
        <button
          type="button"
          className="cursor-pointer truncate rounded-xs border border-transparent px-[2px] py-[6px] font-semibold text-ink hover:border-divider"
          onClick={onOpenDetails}
        >
          {profile.label}
        </button>
      </div>

      <div className="flex flex-1 flex-wrap justify-center gap-x-4 gap-y-[2px] text-n-600 tabular-nums">
        <Temp label="Nozzle" reading={temperatures?.nozzle} ready={ready('nozzle')} />
        <Temp label="Bed" reading={temperatures?.bed} ready={ready('bed')} />
        <Axis label="X" value={position?.x} digits={1} />
        <Axis label="Y" value={position?.y} digits={1} />
        <Axis label="Z" value={position?.z} digits={2} />
      </div>

      <Button onClick={onPreheat} disabled={!connected}>
        Preheat
      </Button>
    </header>
  )
}
