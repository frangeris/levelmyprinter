import type { LevelingSystem } from '../../printers/types.ts'
import { usePrinterStore } from '../../state/printerStore.ts'
import { Button } from '../../ui/Button.tsx'
import { Dialog, DialogActions, Note } from '../../ui/Dialog.tsx'

const NAMES: Record<LevelingSystem, string> = {
  bilinear: 'ABL Bilinear',
  mbl: 'Mesh Bed Leveling',
  ubl: 'Unified Bed Leveling',
  klipper: 'Klipper bed_mesh',
}

/**
 * A hard stop, not a warning.
 *
 * Every system stores its mesh with a different command. Writing `G29 W` at a
 * firmware that expects `M421` is not a degraded experience — it is silently
 * writing nothing, or writing something else, and only finding out after the
 * measurements are gone.
 */
export function UnsupportedDialog({ found, machine }: { found: LevelingSystem; machine: string }) {
  const disconnect = usePrinterStore((s) => s.disconnect)

  return (
    <Dialog labelledBy="unsup-title" className="w-[min(520px,100%)]">
      <h2 id="unsup-title" className="text-title">
        Leveling system not supported
      </h2>
      <p className="leading-[1.6]">
        {machine} uses <b className="font-semibold">{NAMES[found]}</b>. This app only writes ABL
        Bilinear, which stores its mesh with a different command.
      </p>
      <Note>
        Nothing has been sent to the printer beyond the three read-only queries it was asked on
        connect.
      </Note>
      <DialogActions>
        <Button variant="primary" block onClick={() => void disconnect()}>
          Disconnect
        </Button>
      </DialogActions>
    </Dialog>
  )
}
