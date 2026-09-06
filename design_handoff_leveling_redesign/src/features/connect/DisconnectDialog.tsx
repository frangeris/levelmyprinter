import { usePrinterStore } from '../../state/printerStore.ts'

/** Reached by clicking the status light, so it has to say what is lost. */
export function DisconnectDialog({ onClose }: { onClose: () => void }) {
  const disconnect = usePrinterStore((s) => s.disconnect)

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="disconnect-title">
      <div className="dialog" style={{ width: 'min(420px, 100%)' }}>
        <h2 id="disconnect-title">Disconnect the printer?</h2>
        <p>
          The captured points stay in this session, but the printer will stop moving until you
          connect again.
        </p>
        <div className="dialog__actions">
          <div className="dialog__spacer" />
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              onClose()
              void disconnect()
            }}
          >
            Disconnect
          </button>
        </div>
      </div>
    </div>
  )
}
