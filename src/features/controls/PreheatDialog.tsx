import { useState } from 'react'
import type { PrinterProfile } from '../../printers/types.ts'
import type { Leveling } from '../leveling/useLeveling.ts'
import { Button } from '../../ui/Button.tsx'
import { Dialog, DialogActions, DialogSpacer, Field, INPUT } from '../../ui/Dialog.tsx'

interface PreheatDialogProps {
  profile: PrinterProfile
  leveling: Leveling
  onClose: () => void
}

/**
 * Preheat, as two numbers you can change.
 *
 * The checkbox pair is gone. Preheating is the whole point of the dialog now,
 * so it is stated by the fields rather than by a tickbox, and auto-levelling
 * moved out to its own one-time action: it is needed once per printer, not once
 * per session, and it is destructive if run after a manual pass.
 */
export function PreheatDialog({ profile, leveling, onClose }: PreheatDialogProps) {
  const [nozzle, setNozzle] = useState(profile.preheat?.nozzle ?? 200)
  const [bed, setBed] = useState(profile.preheat?.bed ?? 60)

  return (
    <Dialog labelledBy="preheat-title" className="w-[min(540px,100%)]">
      <h2 id="preheat-title" className="text-title">
        Preheat
      </h2>
      <p className="leading-[1.6]">
        Heats to these temperatures before the pass. The bed deforms as it heats.
      </p>

      <div className="flex gap-3">
        <Field label="Nozzle °C">
          <input
            className={`${INPUT} tabular-nums`}
            type="number"
            value={nozzle}
            onChange={(event) => setNozzle(Number(event.target.value))}
          />
        </Field>
        <Field label="Bed °C">
          <input
            className={`${INPUT} tabular-nums`}
            type="number"
            value={bed}
            onChange={(event) => setBed(Number(event.target.value))}
          />
        </Field>
      </div>

      <DialogActions>
        <DialogSpacer />
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => {
            onClose()
            void leveling.prepare({ preheat: true, probe: false, nozzle, bed })
          }}
        >
          Continue
        </Button>
      </DialogActions>
    </Dialog>
  )
}
