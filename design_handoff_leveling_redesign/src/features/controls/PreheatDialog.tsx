import { useState } from 'react'
import type { PrinterProfile } from '../../printers/types.ts'
import type { Leveling } from '../leveling/useLeveling.ts'

interface PreheatDialogProps {
  profile: PrinterProfile
  leveling: Leveling
  onClose: () => void
}

/**
 * Preheat, as two numbers you can change.
 *
 * The checkbox pair is gone. Preheating is the whole point of the dialog now,
 * so it is stated by the fields rather than by a tickbox, and the G29 "pin the
 * grid" option is parked (see the note in the project README): it is needed
 * once per printer, not once per session, and it is destructive if run after a
 * manual pass.
 */
export function PreheatDialog({ profile, leveling, onClose }: PreheatDialogProps) {
  const [nozzle, setNozzle] = useState(profile.preheat?.nozzle ?? 200)
  const [bed, setBed] = useState(profile.preheat?.bed ?? 60)

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="preheat-title">
      <div className="dialog" style={{ width: 'min(540px, 100%)' }}>
        <h2 id="preheat-title">Preheat</h2>
        <p>Heats to these temperatures before the pass. The bed deforms as it heats.</p>

        <div className="temps">
          <label className="field">
            <span>Nozzle °C</span>
            <input
              className="input num"
              type="number"
              value={nozzle}
              onChange={(event) => setNozzle(Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>Bed °C</span>
            <input
              className="input num"
              type="number"
              value={bed}
              onChange={(event) => setBed(Number(event.target.value))}
            />
          </label>
        </div>

        <p className="note">
          <b>Clean the nozzle first</b> — on this printer it is the probe.
        </p>

        <div className="dialog__actions">
          <div className="dialog__spacer" />
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              onClose()
              // See README: sequences.ts must read these overrides for the
              // fields to mean anything; without that change they are display
              // only and the profile's M145 values are used.
              void leveling.prepare({ preheat: true, probe: false, nozzle, bed })
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
