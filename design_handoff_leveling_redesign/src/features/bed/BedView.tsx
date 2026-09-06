import type { PrinterProfile } from '../../printers/types.ts'
import { pointStatus, type SessionPoint } from '../../state/levelingSession.ts'

interface BedViewProps {
  profile: PrinterProfile
  points: SessionPoint[]
  currentIndex: number
  zTarget: number
  onSelectPoint: (index: number) => void
}

/** Dot radius and label clearance, in mm of bed — both scale with the drawing. */
const DOT_R = 7.5
const PENDING_R = 5
const CLEARANCE_PCT = 3.6

const signed = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(3)}`

/**
 * The bed at real scale.
 *
 * Two changes from the first version. The outline is one closed path that
 * includes the two front mounting ears, so orientation is carried by the
 * silhouette instead of a "front of the printer" caption. And the captured
 * values are HTML, not SVG <text>: they take the page's own font metrics, and
 * their clearance from each dot is expressed in percent of the bed so it holds
 * at any rendered size.
 */
export function BedView({ profile, points, currentIndex, zTarget, onSelectPoint }: BedViewProps) {
  const { width, depth } = profile.bed
  const columns = [...new Set(points.map((p) => p.i))].sort((a, b) => a - b)
  const rows = [...new Set(points.map((p) => p.j))].sort((a, b) => a - b)
  const byIndex = (i: number, j: number) => points.find((p) => p.i === i && p.j === j)

  // Ears sit inboard of the corners on the front edge, half as deep as they are
  // tall, and are part of the outline — not two rectangles stuck on.
  const ear = { inset: 28, span: 54, depth: 10, r: 6 }
  const outline = [
    `M${ear.r} 0 H${width - ear.r} A${ear.r} ${ear.r} 0 0 1 ${width} ${ear.r}`,
    `V${depth - ear.r} A${ear.r} ${ear.r} 0 0 1 ${width - ear.r} ${depth}`,
    `H${width - ear.inset - ear.span + ear.span} V${depth + ear.depth - ear.r}`,
    `A${ear.r} ${ear.r} 0 0 1 ${width - ear.inset - ear.r} ${depth + ear.depth}`,
    `H${width - ear.inset - ear.span + ear.r} A${ear.r} ${ear.r} 0 0 1 ${width - ear.inset - ear.span} ${depth + ear.depth - ear.r}`,
    `V${depth} H${ear.inset + ear.span} V${depth + ear.depth - ear.r}`,
    `A${ear.r} ${ear.r} 0 0 1 ${ear.inset + ear.span - ear.r} ${depth + ear.depth}`,
    `H${ear.inset + ear.r} A${ear.r} ${ear.r} 0 0 1 ${ear.inset} ${depth + ear.depth - ear.r}`,
    `V${depth} H${ear.r} A${ear.r} ${ear.r} 0 0 1 0 ${depth - ear.r}`,
    `V${ear.r} A${ear.r} ${ear.r} 0 0 1 ${ear.r} 0 Z`,
  ].join(' ')

  return (
    <div className="bed-frame" style={{ aspectRatio: `${width} / ${depth}` }}>
      <svg
        className="bed"
        viewBox={`0 0 ${width} ${depth}`}
        role="img"
        aria-label={`${width}×${depth} mm bed, front edge marked by its two mounting ears, with ${points.length} leveling points`}
      >
        <path className="bed__outline" d={outline} />

        <g className="bed__grid">
          {rows.map((j) => {
            const first = byIndex(columns[0]!, j)
            const last = byIndex(columns[columns.length - 1]!, j)
            if (!first || !last) return null
            const y = depth - first.pos.y
            return <line key={`r${j}`} x1={first.pos.x} y1={y} x2={last.pos.x} y2={y} />
          })}
          {columns.map((i) => {
            const first = byIndex(i, rows[0]!)
            const last = byIndex(i, rows[rows.length - 1]!)
            if (!first || !last) return null
            return (
              <line
                key={`c${i}`}
                x1={first.pos.x}
                y1={depth - first.pos.y}
                x2={last.pos.x}
                y2={depth - last.pos.y}
              />
            )
          })}
        </g>

        {points.map((point, index) => {
          const status = pointStatus(point, index, currentIndex)
          return (
            <g
              key={`${point.i},${point.j}`}
              className={`bed__point bed__point--${status}`}
              onClick={() => onSelectPoint(index)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelectPoint(index)
              }}
            >
              <title>{`I${point.i} J${point.j} · X${point.pos.x} Y${point.pos.y}`}</title>
              <circle
                className="bed__dot"
                cx={point.pos.x}
                cy={depth - point.pos.y}
                r={status === 'pending' ? PENDING_R : DOT_R}
              />
            </g>
          )
        })}
      </svg>

      {points.map((point, index) => {
        const status = pointStatus(point, index, currentIndex)
        if (status === 'pending') return null
        const left = `${(point.pos.x / width) * 100}%`
        const centre = (depth - point.pos.y) / depth * 100
        // The front row prints above its dot; below would land on the bed's
        // front edge and its ears.
        const front = point.j === rows[0]
        const value = status === 'active' ? zTarget : point.z!

        return (
          <div key={`v${point.i},${point.j}`}>
            {status === 'captured' && (
              <span className="bed__tick" style={{ left, top: `${centre}%` }} aria-hidden="true">
                ✓
              </span>
            )}
            <span
              className={`bed__value${status === 'active' ? ' bed__value--active' : ''}`}
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
    </div>
  )
}
