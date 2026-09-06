import { useEffect, useState } from 'react'
import { Header } from './features/header/Header.tsx'
import { ConnectGate } from './features/connect/ConnectGate.tsx'
import { HomeModal } from './features/connect/HomeModal.tsx'
import { DisconnectDialog } from './features/connect/DisconnectDialog.tsx'
import { UnsupportedDialog } from './features/connect/UnsupportedDialog.tsx'
import { PrinterDetails } from './features/connect/PrinterDetails.tsx'
import { BedView } from './features/bed/BedView.tsx'
import { LevelingControls } from './features/controls/LevelingControls.tsx'
import { PreheatDialog } from './features/controls/PreheatDialog.tsx'
import { AutoLevelDialog } from './features/controls/AutoLevelDialog.tsx'
import { LoadMeshDialog } from './features/controls/LoadMeshDialog.tsx'
import { DraftsDialog } from './features/controls/DraftsDialog.tsx'
import { MeshReview } from './features/review/MeshReview.tsx'
import { usePrinterStore } from './state/printerStore.ts'
import { useLevelingSession } from './state/levelingSession.ts'
import { useLeveling } from './features/leveling/useLeveling.ts'
import { profileMismatches } from './printer/discovery.ts'

/**
 * A full-width notice, fixed to the bottom and out of the flow.
 *
 * These appear and vanish on every command, and as part of the layout each
 * transition moved everything above them — a jog did that twice a click.
 * `z-40` keeps them under the dialogs at 60 and over the workspace.
 */
const STRIP =
  'flex shrink-0 items-center gap-4 px-8 py-3 leading-[1.6] shadow-[0_-6px_20px_rgb(0_0_0/0.5)]'

export function App() {
  const profile = usePrinterStore((s) => s.profile)
  const status = usePrinterStore((s) => s.status)
  const restored = usePrinterStore((s) => s.restored)
  const detected = usePrinterStore((s) => s.detected)
  const restore = usePrinterStore((s) => s.restore)
  const points = useLevelingSession((s) => s.points)
  const currentIndex = useLevelingSession((s) => s.currentIndex)
  const zTarget = useLevelingSession((s) => s.zTarget)
  const start = useLevelingSession((s) => s.start)
  const leveling = useLeveling(profile)

  const [preheatOpen, setPreheatOpen] = useState(false)
  const [autoLevelOpen, setAutoLevelOpen] = useState(false)
  const [loadOpen, setLoadOpen] = useState(false)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  // The connect dialog stays off screen until we know whether the port comes
  // back on its own; otherwise a reload flashes it for a moment on a printer
  // that never went anywhere.
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    void restore().finally(() => setRestoring(false))
  }, [restore])

  // Switching printers changes the whole grid: the session cannot be reused.
  useEffect(() => {
    start(profile)
  }, [profile, start])

  const connected = status === 'connected'
  // What the machine said about itself against what the profile claims. Empty
  // when it stayed quiet — silence is not evidence of a mismatch.
  const mismatches = detected ? profileMismatches(profile, detected) : []
  // Only when the printer actually said so. A firmware that stayed quiet gets
  // the benefit of the doubt and the profile's word.
  const unsupported =
    detected?.leveling && detected.leveling !== 'bilinear' ? detected.leveling : null
  // Homing still has to happen before anything moves, but only a fresh connect
  // gets a modal about it. After a reload the machine is where you left it a
  // moment ago, and being marched through homing again is pure ceremony — the
  // lazy `ensureHomed` in the hook still runs `G28` before the first move, so
  // skipping the dialog costs no safety.
  const askToHome = connected && !unsupported && !restored && !leveling.homed
  const modalOpen =
    !connected ||
    askToHome ||
    unsupported !== null ||
    leveling.write.phase !== 'idle' ||
    preheatOpen ||
    autoLevelOpen ||
    loadOpen ||
    draftsOpen ||
    detailsOpen ||
    disconnectOpen

  return (
    <>
      {/* Nothing is drawn before the printer has said what it is. Until then
          the bed size, the grid and the name would all be a guess, and a guess
          rendered at full size reads as fact. */}
      {connected && (
        <Header
          onPreheat={() => setPreheatOpen(true)}
          onStatusClick={() => setDisconnectOpen(true)}
          onOpenDetails={() => setDetailsOpen(true)}
        />
      )}

      {/* `inert` and not `aria-hidden` while a dialog is up, because the
          backdrop only blocks the mouse — tabbing would still reach the
          buttons underneath. */}
      {connected && (
        <main
          /* An explicit row, not `auto`: both columns need a definite height —
             the bed to size itself against, the controls column for its own
             scroll to work rather than stretch the row. The bottom padding is
             constant whether a strip is showing or not; one that changed with
             them would put the layout shift straight back. */
          className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_clamp(300px,26vw,380px)] grid-rows-[minmax(0,1fr)] gap-8 px-8 pt-2 pb-[76px]"
          inert={modalOpen}
        >
          <div className="flex min-h-0 min-w-0 flex-col items-center justify-center [container-type:size]">
            <BedView
              profile={profile}
              points={points}
              currentIndex={currentIndex}
              zTarget={zTarget}
              verified={leveling.gridVerified}
              onAutoLevel={() => setAutoLevelOpen(true)}
              onSelectPoint={(index) => void leveling.goToPoint(index)}
            />
          </div>

          <LevelingControls
            profile={profile}
            points={points}
            currentIndex={currentIndex}
            leveling={leveling}
            onLoadMesh={() => setLoadOpen(true)}
            onOpenDrafts={() => setDraftsOpen(true)}
          />
        </main>
      )}

      {/* Fixed to the bottom, out of the flow. These come and go with every
          command, and as part of the layout each appearance pushed the page
          down and every disappearance pulled it back — a jog did that twice a
          click. Nothing above them moves now.

          Silent while a dialog is up: every dialog that starts something says
          so on its own button — "Homing…", "Writing point 12 of 25" — and a
          strip repeating it behind the backdrop is the same sentence twice. */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col">
        {/* States of the machine, not of the controls column — so full width. */}
        {!modalOpen && leveling.activity && (
          <div className={`${STRIP} bg-accent-tint text-accent-ink`} role="status">
            <span>{leveling.activity}</span>
          </div>
        )}
        {/* Last, so it sits on top: this one says the app may be drawing the
            wrong machine, which makes anything above it moot. */}
        {!modalOpen && mismatches.length > 0 && (
          <div className={`${STRIP} bg-warn-tint text-warn-ink`}>
            <span className="flex-1">
              <b className="font-semibold">This profile does not match the printer:</b>{' '}
              {mismatches.join('; ')}.
            </span>
          </div>
        )}
      </div>

      {!connected && !restoring && <ConnectGate />}
      {unsupported && (
        <UnsupportedDialog found={unsupported} machine={detected?.machine ?? 'This printer'} />
      )}
      {askToHome && <HomeModal leveling={leveling} />}
      {preheatOpen && (
        <PreheatDialog
          profile={profile}
          leveling={leveling}
          onClose={() => setPreheatOpen(false)}
        />
      )}
      {autoLevelOpen && (
        <AutoLevelDialog
          profile={profile}
          leveling={leveling}
          onClose={() => setAutoLevelOpen(false)}
        />
      )}
      {loadOpen && (
        <LoadMeshDialog points={points} leveling={leveling} onClose={() => setLoadOpen(false)} />
      )}
      {draftsOpen && (
        <DraftsDialog points={points} leveling={leveling} onClose={() => setDraftsOpen(false)} />
      )}
      {detailsOpen && (
        <PrinterDetails
          profile={profile}
          detected={detected}
          onClose={() => setDetailsOpen(false)}
        />
      )}
      {disconnectOpen && <DisconnectDialog onClose={() => setDisconnectOpen(false)} />}
      <MeshReview leveling={leveling} />
    </>
  )
}
