import { usePrinterStore } from '../../state/printerStore.ts'
import { Button } from '../../ui/Button.tsx'
import { Dialog, DialogActions, DialogSpacer } from '../../ui/Dialog.tsx'

/** Reached by clicking the status light, so it has to say what is lost. */
export function DisconnectDialog({ onClose }: { onClose: () => void }) {
  const disconnect = usePrinterStore((s) => s.disconnect)

  return (
    <Dialog labelledBy="disconnect-title" className="w-[min(420px,100%)]">
      <h2 id="disconnect-title" className="text-title">
        Disconnect the printer?
      </h2>
      <p className="leading-[1.6]">
        The captured points stay in this session, but the printer will stop moving until you connect
        again.
      </p>
      <DialogActions>
        <DialogSpacer />
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => {
            onClose()
            void disconnect()
          }}
        >
          Disconnect
        </Button>
      </DialogActions>
    </Dialog>
  )
}
