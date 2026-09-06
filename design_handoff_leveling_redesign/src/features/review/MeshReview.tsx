import { useState } from 'react'
import type { Leveling } from '../leveling/useLeveling.ts'

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
      <div className="dialog-backdrop" role="dialog" aria-modal="true">
        <div className="dialog">
          <h2>{write.phase === 'loading' ? 'Reading current mesh' : 'Writing to printer'}</h2>
          <p>{leveling.busy ?? 'Working…'}</p>
          {write.phase === 'writing' && (
            <p className="note">Do not unplug the USB cable or close this tab until it finishes.</p>
          )}
        </div>
      </div>
    )
  }

  if (write.phase === 'done') {
    const failed = write.rows.filter((row) => !row.ok)
    return (
      <div className="dialog-backdrop" role="dialog" aria-modal="true">
        <div className="dialog" style={{ width: 'min(540px, 100%)' }}>
          <h2>
            {write.ok ? (
              <>
                <span className="tick-ok">✓</span> Mesh written and verified
              </>
            ) : (
              'Written, but not fully verified'
            )}
          </h2>
          <p>
            {write.ok
              ? `All ${write.rows.length} points read back from EEPROM exactly as written.`
              : `${failed.length} of ${write.rows.length} points did not read back as written.`}
          </p>

          {write.ok && <p className="trail">M421 ×{write.rows.length} → M500 → M501 → M503</p>}

          {!write.persisted && (
            <p className="note">
              The printer never reported <code>Settings Stored</code>, so the save to EEPROM may not
              have happened. Power-cycle it and send <code>M503</code> to see what survived.
            </p>
          )}

          {!write.ok && (
            <table className="mesh-table">
              <thead>
                <tr>
                  <th>Point</th>
                  <th className="right">Written</th>
                  <th className="right">Read back</th>
                </tr>
              </thead>
              <tbody>
                {failed.map((row) => (
                  <tr key={`${row.i},${row.j}`}>
                    <td>I{row.i} J{row.j}</td>
                    <td className="right">{signed(row.expected)}</td>
                    <td className="right mismatch">
                      {row.actual === null ? 'missing' : signed(row.actual)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="dialog__actions">
            <div className="dialog__spacer" />
            <button type="button" className="btn btn--primary" onClick={leveling.closeReview}>
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  const changed = write.rows.filter((row) => row.delta !== null && Math.abs(row.delta) >= 0.001)

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="review-title">
      <div className="dialog dialog--wide">
        <h2 id="review-title">Save to printer</h2>
        <p>
          The {write.rows.length} points will replace the current mesh, then be saved to EEPROM.
          {changed.length > 0 && ` ${changed.length} differ from what the printer holds now.`}
        </p>

        <div className="mesh-scroll">
          <table className="mesh-table">
            <thead>
              <tr>
                <th>Point</th>
                <th className="right">Current</th>
                <th className="right">New</th>
              </tr>
            </thead>
            <tbody>
              {write.rows.map((row) => (
                <tr key={`${row.i},${row.j}`}>
                  <td>I{row.i} J{row.j}</td>
                  <td className="right dim">{row.current === null ? '—' : signed(row.current)}</td>
                  <td className="right">{signed(row.next)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showCommands && <pre className="commands">{write.commands.join('\n')}</pre>}

        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={() => setShowCommands((v) => !v)}>
            {showCommands ? 'Hide' : 'Show'} the {write.commands.length} commands
          </button>
          <div className="dialog__spacer" />
          <button type="button" className="btn btn--outline" onClick={leveling.closeReview}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void leveling.confirmWrite()}
            disabled={!leveling.live}
            title={leveling.live ? undefined : 'Not connected'}
          >
            Write {write.rows.length} points
          </button>
        </div>
      </div>
    </div>
  )
}
