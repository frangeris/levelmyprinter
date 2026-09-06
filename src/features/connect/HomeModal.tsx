import { useState } from 'react'
import type { Leveling } from '../leveling/useLeveling.ts'
import { checksSettled, usePrinterStore, type ConnectionCheck } from '../../state/printerStore.ts'
import { Button } from '../../ui/Button.tsx'
import { Dialog, DialogActions, Note } from '../../ui/Dialog.tsx'

/**
 * One answer, stated flat.
 *
 * No tick: the printer replies in a few milliseconds, so a mark that turned
 * green would be animation over nothing. What is worth showing is the answer
 * itself, and the one case that differs is an answer that did not come.
 *
 * One row, one line — a firmware string long enough to wrap would turn a flat
 * list into a ragged block, so the full text goes to the tooltip instead.
 */
function Fact({ check }: { check: ConnectionCheck }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-ink/8 px-[2px] py-[7px]">
      <span className="w-[180px] shrink-0 whitespace-nowrap tracking-[0.08em] text-n-600 uppercase">
        {check.label}
      </span>
      <span
        className={`min-w-0 flex-1 truncate tabular-nums ${
          check.status === 'failed' ? 'text-caution-ink' : ''
        }`}
        title={check.detail ?? undefined}
      >
        {check.detail ?? '…'}
      </span>
    </div>
  )
}

/**
 * Shown as soon as the printer connects, and it does not go away until homing
 * succeeds.
 *
 * It doubles as the interview: everything the app needs to know about this
 * machine is asked here, and every answer is shown. That is not decoration —
 * each line is something the app would otherwise have assumed from a model
 * name. Homing still waits until the asking is done, which on a printer that
 * answers promptly nobody ever notices, and on one that does not is the whole
 * point.
 *
 * There is no "later" option because there is no useful state without homing:
 * Marlin refuses to move before it knows where it is, so every control behind
 * this modal would fail on its first press. The modal closes on its own when
 * `leveling.homed` flips.
 */
export function HomeModal({ leveling }: { leveling: Leveling }) {
  const [failed, setFailed] = useState(false)
  const checks = usePrinterStore((s) => s.checks)
  const busy = leveling.busy !== null
  const settled = checksSettled(checks)

  return (
    <Dialog labelledBy="home-title" className="w-[min(680px,100%)]">
      <h2 id="home-title" className="text-title">
        Printer connected
      </h2>

      <div className="mt-2 mb-3 border-t border-ink/8" aria-live="polite">
        {checks.map((check) => (
          <Fact key={check.id} check={check} />
        ))}
      </div>

      <p className="leading-[1.6]">
        <b className="font-semibold">Clear the bed</b> before homing — the nozzle is the probe, so Z
        homes by touching down at the centre.
      </p>

      {failed && <Note error>Homing did not complete. Try again.</Note>}

      {/* Full width: it is the only way out of this modal, so there is
          nothing for it to sit beside. */}
      <DialogActions>
        <Button
          variant="primary"
          block
          disabled={busy || !settled}
          onClick={() => {
            setFailed(false)
            void leveling.home().then((ok) => setFailed(!ok))
          }}
        >
          {!settled ? 'Checking…' : busy ? 'Homing…' : failed ? 'Retry' : 'Go home'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
