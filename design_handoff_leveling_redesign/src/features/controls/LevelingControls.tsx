import { useEffect, useState } from 'react'
import type { PrinterProfile } from '../../printers/types.ts'
import { capturedCount, isComplete, type SessionPoint, useLevelingSession } from '../../state/levelingSession.ts'
import type { Leveling } from '../leveling/useLeveling.ts'
import { Terminal } from '../terminal/Terminal.tsx'

interface LevelingControlsProps {
  profile: PrinterProfile
  points: SessionPoint[]
  currentIndex: number
  leveling: Leveling
}

/**
 * The working column: which point, the Z being tried, the step, and the way
 * forward. Everything else moved out — the preheat action to the header, the
 * "all captured" summary into the review dialog itself.
 */
export function LevelingControls({ profile, points, currentIndex, leveling }: LevelingControlsProps) {
  const zTarget = useLevelingSession((s) => s.zTarget)
  const step = useLevelingSession((s) => s.step)
  const setStep = useLevelingSession((s) => s.setStep)
  const [confirmRestart, setConfirmRestart] = useState(false)

  const current = points[currentIndex]
  const done = isComplete(points)
  const captured = capturedCount(points)
  const blocked = leveling.busy !== null

  // Hands stay on the keyboard: the pass is twenty-five identical gestures.
  // Radios are included deliberately — a focused step radio would otherwise
  // swallow the arrows and move the selection instead of Z.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName ?? ''
      const typing =
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        (tag === 'INPUT' && (target as HTMLInputElement).type !== 'radio')
      if (typing || blocked || confirmRestart) return

      if (event.key === 'ArrowUp') { event.preventDefault(); leveling.nudge(1) }
      else if (event.key === 'ArrowDown') { event.preventDefault(); leveling.nudge(-1) }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); void leveling.previous() }
      else if (event.key === 'ArrowRight') { event.preventDefault(); void leveling.next() }
      else if (event.key === 'Enter') {
        event.preventDefault()
        if (done) void leveling.openReview()
        else void leveling.capture()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leveling, done, blocked, confirmRestart])

  if (!current) return null

  return (
    <aside className="side">
      <div className="side__top">
        <h2 className="label">Point {currentIndex + 1} of {points.length}</h2>
        <span className="coords">
          I{current.i} J{current.j} · X{current.pos.x} Y{current.pos.y} · {captured} captured
        </span>

        <h2 className="label" style={{ marginTop: 'var(--s4)' }}>Z offset</h2>
        <div className="zblock">
          <span className="zvalue">{zTarget.toFixed(3)}</span>
          <div className="zjog">
            <button type="button" className="btn btn--outline" onClick={() => leveling.nudge(1)} aria-label="Raise Z">▲</button>
            <button type="button" className="btn btn--outline" onClick={() => leveling.nudge(-1)} aria-label="Lower Z">▼</button>
          </div>
        </div>

        <h2 className="label" style={{ marginTop: 'var(--s4)' }}>Step</h2>
        <div className="seg">
          {profile.jog.steps.map((value) => (
            <label key={value} className="seg__opt">
              <input
                type="radio"
                name="step"
                checked={value === step}
                onChange={(event) => {
                  event.currentTarget.blur()
                  setStep(value)
                }}
              />
              {value}
            </label>
          ))}
        </div>
      </div>

      <div className="side__actions">
        <div className="nav-row">
          <button type="button" className="btn btn--outline" onClick={() => void leveling.previous()} disabled={currentIndex === 0 || blocked}>← Previous</button>
          <button type="button" className="btn btn--outline" onClick={() => void leveling.next()} disabled={currentIndex === points.length - 1 || blocked}>Next →</button>
        </div>

        {/* One button carries the pass: it saves until the grid is full, then
            it is the way into the review. */}
        <button
          type="button"
          className="btn btn--primary btn--save"
          onClick={() => (done ? void leveling.openReview() : void leveling.capture())}
          disabled={blocked}
        >
          {done ? 'Continue' : 'Save'}
        </button>

        <div className="hint">↑ ↓ nudge · ⏎ save · ← → point</div>

        <button type="button" className="btn btn--ghost" style={{ marginTop: 'var(--s2)', fontSize: 13 }} onClick={() => setConfirmRestart(true)}>
          Restart
        </button>
      </div>

      <Terminal />

      {confirmRestart && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true">
          <div className="dialog" style={{ width: 'min(420px, 100%)' }}>
            <h2>Restart the pass?</h2>
            <p>
              {captured === 0
                ? 'Nothing has been captured yet — this just sends the head back to point 1.'
                : `${captured} captured ${captured === 1 ? 'value' : 'values'} will be discarded and the pass starts again at point 1. Nothing has been written to the printer.`}
            </p>
            <div className="dialog__actions">
              <div className="dialog__spacer" />
              <button type="button" className="btn btn--outline" onClick={() => setConfirmRestart(false)}>Cancel</button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setConfirmRestart(false)
                  void leveling.reset()
                }}
              >
                Restart
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
