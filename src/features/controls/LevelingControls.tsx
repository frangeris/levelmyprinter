import { useEffect, useState } from 'react'
import type { PrinterProfile } from '../../printers/types.ts'
import {
  capturedCount,
  isComplete,
  type SessionPoint,
  useLevelingSession,
} from '../../state/levelingSession.ts'
import type { Leveling } from '../leveling/useLeveling.ts'
import { Terminal } from '../terminal/Terminal.tsx'
import { Button } from '../../ui/Button.tsx'
import { Dialog, DialogActions, DialogSpacer } from '../../ui/Dialog.tsx'

/** The controls column: its own scroll, so the bed never has to give up room. */
const SIDE = 'flex min-h-0 min-w-0 flex-col overflow-y-auto pr-2 [scrollbar-gutter:stable]'
/** Small-caps section label: the one bit of hierarchy that is not size. */
const LABEL = 'font-semibold tracking-[0.08em] text-n-600 uppercase'
const HINT = 'mt-2 text-n-600'

interface LevelingControlsProps {
  profile: PrinterProfile
  points: SessionPoint[]
  currentIndex: number
  leveling: Leveling
  onLoadMesh: () => void
  onOpenDrafts: () => void
}

/** Half a thousandth: below what the finest jog step can express. */
const SETTLED_MM = 0.0005

/**
 * The working column: which point, the Z being tried, the step, and the way
 * forward. Everything else moved out — the preheat action to the header, the
 * "all captured" summary into the review dialog itself.
 */
export function LevelingControls({
  profile,
  points,
  currentIndex,
  leveling,
  onLoadMesh,
  onOpenDrafts,
}: LevelingControlsProps) {
  const zTarget = useLevelingSession((s) => s.zTarget)
  const step = useLevelingSession((s) => s.step)
  const setStep = useLevelingSession((s) => s.setStep)
  const [confirmRestart, setConfirmRestart] = useState(false)
  // Held only while the field has focus, so a half-typed "0." or "-" never
  // reaches the printer and the display stays authoritative the rest of the time.
  const [typed, setTyped] = useState<string | null>(null)

  const current = points[currentIndex]
  const done = isComplete(points)
  const captured = capturedCount(points)
  const blocked = leveling.busy !== null

  // The primary button carries the pass, so it has to name what is actually
  // next. On a full grid that is normally the review — but not while the point
  // you are standing on has not been checked by hand, which is the whole of the
  // touch-up flow.
  //
  // The test is provenance, not emptiness. Saving a point is what turns it into
  // a measurement, so a value loaded from the printer still has a save to do
  // even though it holds a number — and a point sitting at exactly 0.000 was
  // being read as "nothing to do" and quietly skipped, when 0.000 is a
  // perfectly good reading of a bed that happens to be level there.
  const measured = current?.source === 'measured'
  const changed = current?.z !== null && Math.abs((current?.z ?? 0) - zTarget) > SETTLED_MM
  const saveNext = !measured || changed || !done

  // A measurement taken cold describes a surface that stops existing the moment
  // the printer is used: the bed deforms as it heats and the nozzle — the probe
  // on this machine — grows with it. So saving one is not offered at all, which
  // is a great deal kinder than accepting it and warning about it afterwards.
  // Writing an already-measured grid stays available: those values were taken
  // hot, and refusing to send them because the bed has since cooled would trap
  // half an hour of work in the tab.
  const tooCold = saveNext && !leveling.hot

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
      // Any open dialog owns the keyboard. Without this, Enter on a button
      // inside one would fire the button *and* capture a point behind it.
      if (typing || blocked || confirmRestart || target?.closest('.dialog')) return

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        leveling.nudge(1)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        leveling.nudge(-1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        void leveling.previous()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        void leveling.next()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (!saveNext) void leveling.openReview()
        else if (!tooCold) void leveling.capture()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leveling, saveNext, tooCold, blocked, confirmRestart])

  if (!current) return null

  return (
    <aside className={SIDE}>
      <div className="flex flex-none flex-col">
        <h2 className={LABEL}>
          Point {currentIndex + 1} of {points.length}
        </h2>
        <span className="mt-1 text-n-600 tabular-nums">
          I{current.i} J{current.j} · X{current.pos.x} Y{current.pos.y} · {captured} set
          {current.source === 'printer' && <em className="text-n-400"> · from printer</em>}
        </span>

        <h2 className={`${LABEL} mt-4`}>Z offset</h2>
        <div className="mt-[2px] flex items-center gap-3">
          {/* Editable: the steps only ever reach multiples of themselves, so a
              value loaded from the printer has no route to its neighbour by
              nudging. Typing is the way to any Z at all. */}
          {/* An input wearing the display's clothes: same metrics, no chrome
              until you reach for it. */}
          <input
            className="min-w-0 flex-1 border-none border-b border-b-transparent bg-transparent p-0 text-display leading-none font-semibold tracking-[-0.03em] tabular-nums hover:border-b-divider focus-visible:border-b-accent focus-visible:outline-none"
            value={typed ?? zTarget.toFixed(3)}
            inputMode="decimal"
            spellCheck={false}
            autoComplete="off"
            aria-label="Z offset in millimetres"
            onFocus={(event) => {
              setTyped(zTarget.toFixed(3))
              event.currentTarget.select()
            }}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={() => {
              const value = Number(typed)
              if (typed !== null && typed.trim() !== '' && Number.isFinite(value)) {
                leveling.setZ(value)
              }
              setTyped(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              else if (event.key === 'Escape') {
                setTyped(null)
                event.currentTarget.blur()
              }
            }}
          />
          <div className="flex flex-col gap-1">
            <Button
              className="h-[34px] w-[38px] px-0 py-0"
              onClick={() => leveling.nudge(1)}
              aria-label="Raise Z"
            >
              ▲
            </Button>
            <Button
              className="h-[34px] w-[38px] px-0 py-0"
              onClick={() => leveling.nudge(-1)}
              aria-label="Lower Z"
            >
              ▼
            </Button>
          </div>
        </div>

        <h2 className={`${LABEL} mt-4`}>Step</h2>
        <div className="mt-1 inline-flex overflow-hidden rounded-xs border border-divider">
          {profile.jog.steps.map((value) => (
            <label
              key={value}
              className="inline-flex cursor-pointer items-center px-[16px] py-[8px] tabular-nums not-first:border-l not-first:border-l-divider has-[:checked]:bg-accent has-[:checked]:text-bg has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-accent not-has-[:checked]:hover:bg-ink/7"
            >
              <input
                className="pointer-events-none absolute h-0 w-0 opacity-0"
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

      <div className="shrink-0 pt-4">
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={() => void leveling.previous()}
            disabled={currentIndex === 0 || blocked}
          >
            ← Previous
          </Button>
          <Button
            className="flex-1"
            onClick={() => void leveling.next()}
            disabled={currentIndex === points.length - 1 || blocked}
          >
            Next →
          </Button>
        </div>

        {/* One button carries the pass: it saves until the grid is full, then
            it is the way into the review. */}
        <Button
          variant="primary"
          block
          className="mt-2 px-[24px] py-[12px]"
          onClick={() => (saveNext ? void leveling.capture() : void leveling.openReview())}
          disabled={blocked || tooCold}
          title={tooCold ? 'The printer has to be at temperature first.' : undefined}
        >
          {saveNext ? 'Save' : 'Continue'}
        </Button>

        {/* Takes the place of the keyboard hint when Save is disabled: the line
            is the only thing that says why. */}
        {tooCold ? (
          <div className="mt-2 text-caution-ink">
            Cold {leveling.cold.join(' and ')}, preheat to start.
          </div>
        ) : (
          <div className={HINT}>↑ ↓ nudge · ⏎ save · ← → point</div>
        )}

        {/* The two session-level actions, together: one empties the grid, the
            other fills it from the machine. */}
        {/* Same weight as Previous / Next, one tier down the page. A basis
            rather than a flat `flex-1`: at the narrow end of the column three
            of these do not fit, and a button does not wrap its label — so they
            stack instead of running past the edge. */}
        <div className="mt-3 flex flex-wrap gap-2">
          {/* Nothing captured is nothing to discard — the pass already starts at
              point 1, so the button would only walk the head back to where it
              is. */}
          <Button
            className="flex-[1_1_130px]"
            onClick={() => setConfirmRestart(true)}
            disabled={captured === 0 || blocked}
          >
            Restart
          </Button>
          <Button
            className="flex-[1_1_130px]"
            onClick={onLoadMesh}
            disabled={!leveling.live || blocked}
          >
            Load from printer
          </Button>
          <Button
            className="flex-[1_1_130px]"
            onClick={onOpenDrafts}
            disabled={leveling.drafts.length === 0}
          >
            Measures{leveling.drafts.length > 0 && ` (${leveling.drafts.length})`}
          </Button>
        </div>
      </div>

      <Terminal />

      {confirmRestart && (
        <Dialog labelledBy="restart-title" className="w-[min(420px,100%)]">
          <h2 id="restart-title" className="text-title">
            Restart the pass?
          </h2>
          <p className="leading-[1.6]">
            {captured === 0
              ? 'Nothing has been captured yet — this just sends the head back to point 1.'
              : `${captured} captured ${captured === 1 ? 'value' : 'values'} will be discarded and the pass starts again at point 1. Nothing has been written to the printer.`}
          </p>
          <DialogActions>
            <DialogSpacer />
            <Button onClick={() => setConfirmRestart(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmRestart(false)
                void leveling.reset()
              }}
            >
              Restart
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </aside>
  )
}
