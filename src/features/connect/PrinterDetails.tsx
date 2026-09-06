import { useState } from 'react'
import type { PrinterProfile } from '../../printers/types.ts'
import { machineKey } from '../../printers/derive.ts'
import type { DetectedPrinter } from '../../printer/discovery.ts'
import { usePrinterStore } from '../../state/printerStore.ts'
import { gridKey, pinnedGrid } from '../../state/pinnedGrids.ts'
import { Button } from '../../ui/Button.tsx'
import { Dialog, DialogActions, DialogSpacer, Field, INPUT, Note } from '../../ui/Dialog.tsx'

interface PrinterDetailsProps {
  profile: PrinterProfile
  detected: DetectedPrinter | null
  onClose: () => void
}

/**
 * One belief and its provenance.
 *
 * The source column is the point: a number read from `M211` and a number the
 * app worked out from a rule of thumb look identical once they are both driving
 * the machine, and only one of them is worth trusting.
 */
function Row({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-ink/8 px-[2px] py-[7px]">
      <span className="w-[160px] shrink-0 whitespace-nowrap tracking-[0.08em] text-n-600 uppercase">
        {label}
      </span>
      <span className="min-w-0 flex-1 tabular-nums">{value}</span>
      <code className="shrink-0 font-mono text-n-400">{source}</code>
    </div>
  )
}

/**
 * Everything the app believes about the printer, and where each belief came
 * from.
 *
 * The source column is the point. A number read from `M211` and a number the
 * app worked out from a rule of thumb look identical once they are both driving
 * the machine, and only one of them is worth trusting.
 */
export function PrinterDetails({ profile, detected, onClose }: PrinterDetailsProps) {
  const setGridBounds = usePrinterStore((s) => s.setGridBounds)
  const { min, max } = profile.mesh

  const [minX, setMinX] = useState(String(min.x))
  const [maxX, setMaxX] = useState(String(max.x))
  const [minY, setMinY] = useState(String(min.y))
  const [maxY, setMaxY] = useState(String(max.y))

  const pinned = pinnedGrid(
    gridKey(detected?.uuid ?? null, detected?.machine ?? null, profile.id),
    profile,
  )
  const numbers = [minX, maxX, minY, maxY].map(Number)
  const valid =
    numbers.every(Number.isFinite) && numbers[1]! > numbers[0]! && numbers[3]! > numbers[2]!

  return (
    <Dialog labelledBy="details-title" className="h-[min(86vh,720px)] min-h-0 w-[min(720px,100%)]">
      <h2 id="details-title" className="text-title">
        {profile.label}
      </h2>
      <p className="leading-[1.6]">
        Read off the printer on connect. The last column is the command that said so.
      </p>

      <div className="min-h-0 flex-auto overflow-y-auto [scrollbar-gutter:stable]">
        <Row label="Firmware" value={detected?.firmware ?? '—'} source="M115" />
        <Row label="Machine" value={detected?.machine ?? '—'} source="M115" />
        <Row label="Serial" value={`${profile.baudRate} baud`} source="handshake" />
        <Row
          label="Leveling"
          value={detected?.leveling ?? `${profile.leveling} (assumed)`}
          source="M503"
        />
        <Row
          label="Grid"
          value={`${profile.mesh.cols} × ${profile.mesh.rows} points`}
          source="M503"
        />
        <Row
          label="Bed"
          value={`${profile.bed.width} × ${profile.bed.depth} mm`}
          source={detected?.travel ? 'M211' : 'profile'}
        />
        <Row
          label="Travel"
          value={`X ${profile.travel.min.x}…${profile.travel.max.x} · Y ${profile.travel.min.y}…${profile.travel.max.y} · Z ${profile.travel.min.z}…${profile.travel.max.z}`}
          source={detected?.travel ? 'M211' : 'profile'}
        />
        <Row
          label="Z resolution"
          value={detected?.zResolution ? `${detected.zResolution.toFixed(4)} mm/step` : '—'}
          source="M92"
        />
        <Row
          label="Max Z speed"
          value={`${profile.feedrates.travelZ} mm/min`}
          source={detected?.maxFeedrateZ ? 'M203' : 'profile'}
        />
        <Row
          label="Fade height"
          value={`${profile.fadeHeight} mm`}
          source={detected?.fadeHeight !== null ? 'M420' : 'profile'}
        />
        <Row
          label="Probe offset"
          value={
            detected?.probeOffset
              ? `X${detected.probeOffset.x} Y${detected.probeOffset.y} Z${detected.probeOffset.z}`
              : '—'
          }
          source="M851"
        />
        <Row
          label="Preheat"
          value={profile.preheat ? `${profile.preheat.nozzle}° / ${profile.preheat.bed}°` : '—'}
          source={detected?.preheat ? 'M145' : 'profile'}
        />
      </div>

      <h2 className="mt-2 font-semibold">Grid bounds</h2>
      <p className="leading-[1.6]">
        {pinned?.source === 'probed'
          ? 'Imposed on this printer by an auto-level run, so the firmware holds these numbers.'
          : pinned
            ? 'Stated by hand. The app draws the points here because you said this is where they are.'
            : 'The one thing no command reports. Nothing is drawn on the bed until it is settled — either by an auto-level run, or by typing what this machine already has.'}
      </p>

      <div className="flex gap-3">
        <Field label="X from">
          <input
            className={`${INPUT} tabular-nums`}
            value={minX}
            onChange={(e) => setMinX(e.target.value)}
          />
        </Field>
        <Field label="X to">
          <input
            className={`${INPUT} tabular-nums`}
            value={maxX}
            onChange={(e) => setMaxX(e.target.value)}
          />
        </Field>
        <Field label="Y from">
          <input
            className={`${INPUT} tabular-nums`}
            value={minY}
            onChange={(e) => setMinY(e.target.value)}
          />
        </Field>
        <Field label="Y to">
          <input
            className={`${INPUT} tabular-nums`}
            value={maxY}
            onChange={(e) => setMaxY(e.target.value)}
          />
        </Field>
      </div>

      <Note>
        Saving moves every point on the bed and counts as knowing where the grid is. Only type
        numbers this printer really has — nothing here checks them against the machine.
      </Note>

      <DialogActions>
        <DialogSpacer />
        <Button onClick={onClose}>Close</Button>
        <Button
          variant="primary"
          disabled={!valid}
          title={valid ? undefined : 'Each "to" has to be greater than its "from"'}
          onClick={() => {
            setGridBounds(
              { x: numbers[0]!, y: numbers[2]! },
              { x: numbers[1]!, y: numbers[3]! },
              detected ? machineKey(detected, profile.id) : profile.id,
            )
            onClose()
          }}
        >
          Save bounds
        </Button>
      </DialogActions>
    </Dialog>
  )
}
