import type { CSSProperties } from 'react'
import type { PrinterProfile } from '../../printers/types.ts'
import { bedToScreen } from '../../printer/meshGeometry.ts'
import { pointStatus, type SessionPoint } from '../../state/levelingSession.ts'

interface BedViewProps {
  profile: PrinterProfile
  points: SessionPoint[]
  currentIndex: number
  zTarget: number
  /**
   * Whether anyone has established where the grid physically sits.
   *
   * Not whether to draw it. *Which* points exist is read off the printer's own
   * `G29 W I.. J..` lines; where they fall in millimetres is estimated from the
   * travel limits, the probe offset and Marlin's probing margin. That estimate
   * is good enough to work from — it is the app's own choice of bounds, and a
   * `G29 L R F B` makes it exact. Until then the drawing says so rather than
   * pretending the position is measured.
   */
  verified: boolean
  /** Offered from the caption when the position is still an estimate. */
  onAutoLevel: () => void
  onSelectPoint: (index: number) => void
}

/** Dot radius and label clearance, in mm of bed — both scale with the drawing. */
const DOT_R = 7.5
const PENDING_R = 5
const CLEARANCE_PCT = 3.6

/** Front mounting ears, in mm: what tells you which edge faces you. */
const EAR = { inset: 28, span: 54, depth: 10, r: 6 }

const signed = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(3)}`

/**
 * How a point is drawn, by what is known about it.
 *
 * `unverified` is a value read out of the printer: real, but nobody has checked
 * it. A ring reads as "filled in" without claiming the tick's meaning.
 */
const DOT: Record<string, string> = {
  pending: 'fill-bg stroke-n-400 [stroke-width:1.2]',
  active: 'fill-ink stroke-ink [stroke-width:0]',
  captured: 'fill-ok stroke-ok [stroke-width:0]',
  unverified: 'fill-bg stroke-ok [stroke-width:1.6]',
}

/**
 * The bed at real scale.
 *
 * Two things carry the drawing. The outline is one closed path that includes
 * the two front mounting ears, so orientation comes from the silhouette instead
 * of a "front of the printer" caption. And the values are HTML, not SVG
 * `<text>`: they take the page's own font metrics, and their clearance from
 * each dot is expressed in percent of the bed so it holds at any rendered size.
 */
export function BedView({
  profile,
  points,
  currentIndex,
  zTarget,
  verified,
  onAutoLevel,
  onSelectPoint,
}: BedViewProps) {
  const { width, depth } = profile.bed
  // The viewBox is in millimetres, so screen coordinates are bed coordinates
  // with Y flipped. Same helper the geometry tests cover.
  const toScreen = (point: SessionPoint) => bedToScreen(profile, point.pos, width, depth)

  const columns = [...new Set(points.map((p) => p.i))].sort((a, b) => a - b)
  const rows = [...new Set(points.map((p) => p.j))].sort((a, b) => a - b)
  const byIndex = (i: number, j: number) => points.find((p) => p.i === i && p.j === j)

  // Ears sit inboard of the front corners and are part of the outline, not two
  // rectangles stuck on: a silhouette reads as a shape, an assembly does not.
  const outline = [
    `M${EAR.r} 0 H${width - EAR.r} A${EAR.r} ${EAR.r} 0 0 1 ${width} ${EAR.r}`,
    `V${depth - EAR.r} A${EAR.r} ${EAR.r} 0 0 1 ${width - EAR.r} ${depth}`,
    `H${width - EAR.inset} V${depth + EAR.depth - EAR.r}`,
    `A${EAR.r} ${EAR.r} 0 0 1 ${width - EAR.inset - EAR.r} ${depth + EAR.depth}`,
    `H${width - EAR.inset - EAR.span + EAR.r}`,
    `A${EAR.r} ${EAR.r} 0 0 1 ${width - EAR.inset - EAR.span} ${depth + EAR.depth - EAR.r}`,
    `V${depth} H${EAR.inset + EAR.span} V${depth + EAR.depth - EAR.r}`,
    `A${EAR.r} ${EAR.r} 0 0 1 ${EAR.inset + EAR.span - EAR.r} ${depth + EAR.depth}`,
    `H${EAR.inset + EAR.r} A${EAR.r} ${EAR.r} 0 0 1 ${EAR.inset} ${depth + EAR.depth - EAR.r}`,
    `V${depth} H${EAR.r} A${EAR.r} ${EAR.r} 0 0 1 0 ${depth - EAR.r}`,
    `V${EAR.r} A${EAR.r} ${EAR.r} 0 0 1 ${EAR.r} 0 Z`,
  ].join(' ')

  // Handed to CSS rather than baked into a class: the frame has to be exactly
  // the bed rectangle for the overlay labels to stay on their dots, and both
  // numbers are properties of the profile, not of the layout.
  const frame = {
    '--bed-ratio': width / depth,
    '--ear-overhang': `${(EAR.depth / depth) * 100}%`,
  } as CSSProperties

  return (
    /* The frame IS the bed rectangle, so the HTML value labels can be placed in
       percentages of it and stay in register with the SVG at any size.

       Which means the ratio must hold exactly. `h-full` with a max width does
       not do that: once the width is clamped the height stays where it was put
       and the box stretches, sliding every overlay label off its dot. Sizing
       off the limiting axis keeps one dimension `auto`, so the aspect governs. */
    <div
      className="relative mb-[56px] aspect-[var(--bed-ratio)] h-[min(calc(100cqh-56px),calc(100cqw/var(--bed-ratio)))]"
      style={frame}
    >
      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        viewBox={`0 0 ${width} ${depth}`}
        role="img"
        aria-label={`${width}×${depth} mm bed, front edge marked by its two mounting ears, with ${
          points.length
        } leveling points${verified ? '' : ' at estimated positions'}`}
      >
        <path className="fill-none stroke-n-400 [stroke-width:1]" d={outline} />

        {/* Dashed while the position is an estimate: the lines are where the
            app believes the grid runs, not where it measured it. */}
        <g
          className={`stroke-n-300 [stroke-width:0.8] ${verified ? '' : '[stroke-dasharray:4_4]'}`}
        >
          {rows.map((j) => {
            const first = byIndex(columns[0]!, j)
            const last = byIndex(columns[columns.length - 1]!, j)
            if (!first || !last) return null
            const a = toScreen(first)
            const b = toScreen(last)
            return <line key={`r${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          })}
          {columns.map((i) => {
            const first = byIndex(i, rows[0]!)
            const last = byIndex(i, rows[rows.length - 1]!)
            if (!first || !last) return null
            const a = toScreen(first)
            const b = toScreen(last)
            return <line key={`c${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          })}
        </g>

        {points.map((point, index) => {
          const { x, y } = toScreen(point)
          const status = pointStatus(point, index, currentIndex)
          // Read out of the printer, not checked by hand: a ring, not a disc.
          const unverified = status === 'captured' && point.source === 'printer'
          return (
            <g
              key={`${point.i},${point.j}`}
              className="group"
              onClick={() => onSelectPoint(index)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelectPoint(index)
              }}
            >
              <title>
                {`I${point.i} J${point.j} · X${point.pos.x} Y${point.pos.y}` +
                  (unverified ? ' · from the printer' : '')}
              </title>
              <circle
                className={`cursor-pointer group-hover:stroke-ink ${DOT[unverified ? 'unverified' : status]}`}
                cx={x}
                cy={y}
                r={status === 'pending' ? PENDING_R : DOT_R}
              />
            </g>
          )
        })}
      </svg>

      {points.map((point, index) => {
        const status = pointStatus(point, index, currentIndex)
        if (status === 'pending') return null
        const { x, y } = toScreen(point)
        const left = `${(x / width) * 100}%`
        const centre = (y / depth) * 100
        // The front row prints above its dot; below would land on the bed's
        // front edge and its ears.
        const front = point.j === rows[0]
        const value = status === 'active' ? zTarget : point.z!

        return (
          <div key={`v${point.i},${point.j}`}>
            {/* The tick means someone checked this point. A value read out of
                the printer has not been, so it gets the ring and no tick. */}
            {status === 'captured' && point.source === 'measured' && (
              <span
                className="pointer-events-none absolute -translate-1/2 leading-none font-semibold text-bg"
                style={{ left, top: `${centre}%` }}
                aria-hidden="true"
              >
                ✓
              </span>
            )}
            <span
              className={`pointer-events-none absolute whitespace-nowrap tabular-nums ${
                status === 'active' ? 'font-semibold text-ink' : 'text-ok'
              }`}
              style={{
                left,
                top: `${centre + (front ? -CLEARANCE_PCT : CLEARANCE_PCT)}%`,
                transform: front ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
              }}
            >
              {signed(value)}
            </span>
          </div>
        )
      })}

      {/* Anchored to the frame, which *is* the bed rectangle, so these name the
          bed's own origin rather than the column's corner. Below the ears,
          which hang past that rectangle by a share of its depth. */}
      <span className="absolute top-[calc(100%+var(--ear-overhang))] left-0 mt-2 tracking-[0.06em] text-n-600 uppercase">
        X0 Y0
      </span>

      {/* The honest half of drawing an estimate: the points are where the app
          would put them, and the auto-level is what makes that the firmware's
          opinion too. On the bed rather than under it, because it is about the
          drawing — but along the top edge, in the margin the probing inset
          leaves above the back row, so it states itself without standing on a
          point you might want to click. */}
      {!verified && (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-1">
          <button
            type="button"
            className="pointer-events-auto cursor-pointer rounded-full border border-divider bg-surface px-3 py-[6px] text-n-600 shadow-[0_2px_12px_rgb(0_0_0/0.6)] hover:border-n-400"
            onClick={onAutoLevel}
          >
            Positions estimated ·{' '}
            <span className="text-accent-ink">Auto-level to make them accurate</span>
          </button>
        </div>
      )}
    </div>
  )
}
