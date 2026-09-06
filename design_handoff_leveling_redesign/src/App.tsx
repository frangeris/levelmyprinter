import { useEffect, useState } from 'react'
import { Header } from './features/header/Header.tsx'
import { ConnectGate } from './features/connect/ConnectGate.tsx'
import { HomeModal } from './features/connect/HomeModal.tsx'
import { DisconnectDialog } from './features/connect/DisconnectDialog.tsx'
import { BedView } from './features/bed/BedView.tsx'
import { LevelingControls } from './features/controls/LevelingControls.tsx'
import { PreheatDialog } from './features/controls/PreheatDialog.tsx'
import { HeatProgress, isHeating } from './features/controls/HeatProgress.tsx'
import { MeshReview } from './features/review/MeshReview.tsx'
import { usePrinterStore } from './state/printerStore.ts'
import { useLevelingSession } from './state/levelingSession.ts'
import { useLeveling } from './features/leveling/useLeveling.ts'

export function App() {
  const profile = usePrinterStore((s) => s.profile)
  const status = usePrinterStore((s) => s.status)
  const temperatures = usePrinterStore((s) => s.temperatures)
  const points = useLevelingSession((s) => s.points)
  const currentIndex = useLevelingSession((s) => s.currentIndex)
  const zTarget = useLevelingSession((s) => s.zTarget)
  const start = useLevelingSession((s) => s.start)
  const leveling = useLeveling(profile)

  const [preheatOpen, setPreheatOpen] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  useEffect(() => {
    start(profile)
  }, [profile, start])

  const connected = status === 'connected'
  const askToHome = connected && !leveling.homed
  const modalOpen =
    !connected || askToHome || leveling.write.phase !== 'idle' || preheatOpen || disconnectOpen

  return (
    <>
      <Header
        onPreheat={() => setPreheatOpen(true)}
        onStatusClick={() => connected && setDisconnectOpen(true)}
      />

      {/* The strips are full width and sit under the header: they are states of
          the machine, not of the controls column. */}
      {leveling.busy && (
        <div className="strip strip--busy" role="status">
          <span>{leveling.busy}</span>
          {isHeating(temperatures) && <HeatProgress temperatures={temperatures} />}
        </div>
      )}
      {!leveling.busy && leveling.warnings.length > 0 && (
        <div className="strip strip--warn">
          <span className="strip__body">
            <b>Quick mode.</b> Movement works, measurements are not trustworthy yet:{' '}
            {leveling.warnings.join(' ')}
          </span>
        </div>
      )}

      <main className="main" inert={modalOpen}>
        <div className="stage">
          <BedView
            profile={profile}
            points={points}
            currentIndex={currentIndex}
            zTarget={zTarget}
            onSelectPoint={(index) => void leveling.goToPoint(index)}
          />
          <div className="bed__axis"><span>X0 Y0</span></div>
        </div>

        <LevelingControls
          profile={profile}
          points={points}
          currentIndex={currentIndex}
          leveling={leveling}
        />
      </main>

      {!connected && <ConnectGate />}
      {askToHome && <HomeModal profile={profile} leveling={leveling} />}
      {preheatOpen && (
        <PreheatDialog profile={profile} leveling={leveling} onClose={() => setPreheatOpen(false)} />
      )}
      {disconnectOpen && <DisconnectDialog onClose={() => setDisconnectOpen(false)} />}
      <MeshReview leveling={leveling} />
    </>
  )
}
