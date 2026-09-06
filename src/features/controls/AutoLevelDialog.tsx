import type { PrinterProfile } from '../../printers/types.ts'
import type { Leveling } from '../leveling/useLeveling.ts'
import { Button } from '../../ui/Button.tsx'
import { Dialog, DialogActions, DialogSpacer, Note } from '../../ui/Dialog.tsx'

interface AutoLevelDialogProps {
  profile: PrinterProfile
  leveling: Leveling
  onClose: () => void
}

/**
 * The printer's own auto bed levelling — `G29`, with the bounds spelled out.
 *
 * It used to be called "pin the grid", after the side effect this app cares
 * about. That was the wrong name: what it *does* is probe every point and
 * replace the mesh, and a name that hides the destructive half is the kind of
 * name that gets someone's afternoon overwritten.
 *
 * It is also not a per-session step. The bounds go to EEPROM and survive a
 * power cycle, so this is once per printer — and it is the one thing here that
 * must never run after a manual pass.
 */
export function AutoLevelDialog({ profile, leveling, onClose }: AutoLevelDialogProps) {
  const { cols, rows, min, max } = profile.mesh
  const points = cols * rows

  return (
    <Dialog labelledBy="level-title" className="w-[min(540px,100%)]">
      <h2 id="level-title" className="text-title">
        Auto-level the bed
      </h2>
      <p className="leading-[1.6]">
        The printer&apos;s own levelling run: it probes {points} points and writes the result as its
        mesh. Takes several minutes.
      </p>

      <Note error>
        <b className="font-semibold">Replaces the current mesh</b> and saves itself to EEPROM. Run
        it before measuring, never after.
      </Note>

      <Note>
        It asks for X{min.x}–{max.x} / Y{min.y}–{max.y} and the firmware keeps them. That is what
        lets the app draw the points at all, and it survives a power cycle.
      </Note>

      <DialogActions>
        <DialogSpacer />
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => {
            onClose()
            void leveling.prepare({ preheat: false, probe: true })
          }}
        >
          Auto-level
        </Button>
      </DialogActions>
    </Dialog>
  )
}
