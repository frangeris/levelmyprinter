import { useState } from 'react'
import { capturedCount, type SessionPoint } from '../../state/levelingSession.ts'
import type { Leveling, MeshLoadResult } from '../leveling/useLeveling.ts'
import { Button } from '../../ui/Button.tsx'
import { Dialog, DialogActions, DialogSpacer, Note } from '../../ui/Dialog.tsx'

interface LoadMeshDialogProps {
  points: SessionPoint[]
  leveling: Leveling
  onClose: () => void
}

type Phase =
  { kind: 'confirm' } | { kind: 'loading' } | { kind: 'done'; result: MeshLoadResult | null }

/**
 * Pulls the printer's current mesh into the session.
 *
 * The point of it is the touch-up pass: you already have a mesh that mostly
 * works and want to redo three points, not twenty-five. It confirms first
 * because it overwrites whatever the session holds, and it reports the count
 * afterwards because "nothing happened" and "the printer has no mesh" look
 * identical on the bed diagram otherwise.
 */
export function LoadMeshDialog({ points, leveling, onClose }: LoadMeshDialogProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' })
  const captured = capturedCount(points)

  if (phase.kind === 'loading') {
    return (
      <Dialog labelledBy="load-title">
        <h2 id="load-title" className="text-title">
          Reading the printer
        </h2>
        <p className="leading-[1.6]">{leveling.busy ?? 'Working…'}</p>
      </Dialog>
    )
  }

  if (phase.kind === 'done') {
    const { result } = phase
    // More than half the grid at exactly zero is not a bed anyone probed: it is
    // what an unprobed or reset mesh reads as. Reporting only the count would
    // make that look like a successful load of 25 real values.
    const flat = result !== null && result.loaded > 0 && result.zeros > result.loaded / 2

    return (
      <Dialog labelledBy="load-title">
        <h2 id="load-title" className="text-title">
          {result === null || result.loaded === 0 ? (
            'Nothing to load'
          ) : flat ? (
            'The printer has no real mesh'
          ) : (
            <>
              <span className="text-ok">✓</span> Loaded {result.loaded} points
            </>
          )}
        </h2>

        {result === null && (
          <p className="leading-[1.6]">
            The printer did not answer. Check the connection and try again.
          </p>
        )}

        {result !== null && result.loaded === 0 && (
          <p className="leading-[1.6]">
            The printer has no mesh yet. Auto-level first: that is what creates one.
          </p>
        )}

        {flat && result !== null && (
          <>
            <p className="leading-[1.6]">
              {result.zeros} of {result.loaded} points came back as exactly zero — what an unprobed
              grid reads as.
            </p>
            <Note>Auto-level for a fresh baseline, then measure over it.</Note>
          </>
        )}

        {result !== null && result.loaded > 0 && !flat && (
          <p className="leading-[1.6]">
            They show as rings, not ticks: the printer&apos;s numbers until you check one yourself.
          </p>
        )}

        <DialogActions>
          <DialogSpacer />
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    )
  }

  return (
    <Dialog labelledBy="load-title" className="w-[min(540px,100%)]">
      <h2 id="load-title" className="text-title">
        Load the current mesh
      </h2>
      <p className="leading-[1.6]">
        Puts the printer&apos;s {points.length} values on the grid, so you can adjust single points
        instead of measuring them all again.
      </p>

      {captured > 0 && (
        <Note>
          Replaces the {captured} {captured === 1 ? 'value' : 'values'} on the grid. They are saved
          as a measure first.
        </Note>
      )}

      <DialogActions>
        <DialogSpacer />
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!leveling.live}
          title={leveling.live ? undefined : 'Not connected'}
          onClick={() => {
            setPhase({ kind: 'loading' })
            void leveling.loadFromPrinter().then((result) => setPhase({ kind: 'done', result }))
          }}
        >
          Load
        </Button>
      </DialogActions>
    </Dialog>
  )
}
