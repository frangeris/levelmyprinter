import { useState } from 'react'
import type { Leveling } from '../leveling/useLeveling.ts'
import { Button } from '../../ui/Button.tsx'
import { Dialog, DialogActions, DialogSpacer, Note } from '../../ui/Dialog.tsx'

/** A dialog that holds a long list: fixed height, and the list scrolls in it. */
const TALL = 'w-[min(640px,100%)] h-[min(86vh,720px)] min-h-0'
const TH =
  'sticky top-0 bg-surface border-b border-divider p-2 text-left font-normal tracking-[0.08em] text-n-600 uppercase'
const TD = 'border-b border-ink/8 px-2 py-[8px]'
const CODE = 'font-mono'

const signed = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(3)}`

/**
 * The last stop before the mesh is overwritten.
 *
 * Trimmed hard: the Change column went (Current beside New already shows the
 * change, and a third number of the same kind read as noise), and so did the
 * two explanatory paragraphs. What is left is the comparison, the exact
 * commands on demand, and the two buttons.
 */
export function MeshReview({ leveling }: { leveling: Leveling }) {
  const [showCommands, setShowCommands] = useState(false)
  const { write } = leveling

  if (write.phase === 'idle') return null

  if (write.phase === 'loading' || write.phase === 'writing') {
    return (
      <Dialog labelledBy="write-title">
        <h2 id="write-title" className="text-title">
          {write.phase === 'loading' ? 'Reading current mesh' : 'Writing to printer'}
        </h2>
        <p className="leading-[1.6]">{leveling.busy ?? 'Working…'}</p>
        {write.phase === 'writing' && (
          <Note>Do not unplug the USB cable or close this tab until it finishes.</Note>
        )}
      </Dialog>
    )
  }

  if (write.phase === 'done') {
    const failed = write.rows.filter((row) => !row.ok)
    return (
      <Dialog labelledBy="done-title" className="max-h-[86vh] w-[min(540px,100%)]">
        <h2 id="done-title" className="text-title">
          {write.ok ? (
            <>
              <span className="text-ok">✓</span> Mesh written and verified
            </>
          ) : (
            'Written, but not fully verified'
          )}
        </h2>
        <p className="leading-[1.6]">
          {write.ok
            ? `All ${write.rows.length} points read back from EEPROM exactly as written.`
            : `${failed.length} of ${write.rows.length} points did not read back as written.`}
        </p>

        {write.ok && <p className="font-mono text-n-600">{write.trail.join(' → ')}</p>}

        {!write.persisted && (
          <Note error>
            The printer never reported <code className={CODE}>Settings Stored</code>, so the save to
            EEPROM may not have happened. Power-cycle it and send <code className={CODE}>M503</code>{' '}
            to see what survived.
          </Note>
        )}

        {!write.ok && (
          <div className="min-h-0 flex-auto overflow-y-auto pr-1 [scrollbar-gutter:stable]">
            <table className="w-full border-collapse tabular-nums">
              <thead>
                <tr>
                  <th className={TH}>Point</th>
                  <th className={`${TH} text-right`}>Written</th>
                  <th className={`${TH} text-right`}>Read back</th>
                </tr>
              </thead>
              <tbody>
                {failed.map((row) => (
                  <tr key={`${row.i},${row.j}`}>
                    <td className={TD}>
                      I{row.i} J{row.j}
                    </td>
                    <td className={`${TD} text-right`}>{signed(row.expected)}</td>
                    <td className={`${TD} text-right text-warn-ink`}>
                      {row.actual === null ? 'missing' : signed(row.actual)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogActions>
          <DialogSpacer />
          <Button variant="primary" onClick={leveling.closeReview}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    )
  }

  if (write.phase === 'unsupported') {
    return (
      <Dialog labelledBy="unsupported-title" className="w-[min(560px,100%)]">
        <h2 id="unsupported-title" className="text-title">
          This printer will not take a written mesh
        </h2>
        <p className="leading-[1.6]">
          Each write clears the whole grid before setting its own point, so sending them one by one
          leaves only the last.
          {write.kept &&
            ` Two points were sent; only I${write.kept.i} J${write.kept.j} survived, at ${signed(
              write.kept.z,
            )}.`}
        </p>
        <Note>
          Stopped after two rather than twenty-five. Your measurements are untouched and still on
          the grid — and the mesh the printer held is saved under <b>Measures</b>.
        </Note>
        <DialogActions>
          <DialogSpacer />
          <Button variant="primary" onClick={leveling.closeReview}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    )
  }

  const changed = write.rows.filter((row) => row.delta !== null && Math.abs(row.delta) >= 0.001)

  return (
    <Dialog labelledBy="review-title" className={TALL}>
      <h2 id="review-title" className="text-title">
        Save to printer
      </h2>
      <p className="leading-[1.6]">
        The {write.rows.length} points will replace the current mesh, then be saved to EEPROM.
        {changed.length > 0 && ` ${changed.length} differ from what the printer holds now.`}
      </p>

      <div className="min-h-0 flex-auto overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        <table className="w-full border-collapse tabular-nums">
          <thead>
            <tr>
              <th className={TH}>Point</th>
              <th className={`${TH} text-right`}>Current</th>
              <th className={`${TH} text-right`}>New</th>
            </tr>
          </thead>
          <tbody>
            {write.rows.map((row) => (
              <tr key={`${row.i},${row.j}`}>
                <td className={TD}>
                  I{row.i} J{row.j}
                </td>
                <td className={`${TD} text-right text-n-600`}>
                  {row.current === null ? '—' : signed(row.current)}
                </td>
                <td className={`${TD} text-right`}>{signed(row.next)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCommands && (
        <pre className="max-h-[140px] shrink-0 overflow-auto rounded-xs bg-inset px-3 py-2 font-mono leading-[1.6]">
          {write.commands.join('\n')}
        </pre>
      )}

      <DialogActions>
        <Button variant="ghost" onClick={() => setShowCommands((v) => !v)}>
          {showCommands ? 'Hide' : 'Show'} the {write.commands.length} commands
        </Button>
        <DialogSpacer />
        <Button onClick={leveling.closeReview}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => void leveling.confirmWrite()}
          disabled={!leveling.live}
          title={leveling.live ? undefined : 'Not connected'}
        >
          Write {write.rows.length} points
        </Button>
      </DialogActions>
    </Dialog>
  )
}
