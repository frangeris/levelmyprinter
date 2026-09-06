import { usePrinterStore } from '../../state/printerStore.ts'
import { BrowserCheck } from './BrowserCheck.tsx'
import { isWebSerialSupported } from '../../serial/connect.ts'
import { Button } from '../../ui/Button.tsx'
import { Dialog, DialogActions } from '../../ui/Dialog.tsx'

/**
 * The way into the app.
 *
 * No model to pick: the printer is asked who it is the moment the port opens,
 * and answers with more than a dropdown ever held — its grid, its limits, its
 * leveling system. Making someone choose first was asking them to repeat what
 * the machine was about to say.
 */
export function ConnectGate() {
  const status = usePrinterStore((s) => s.status)
  const connect = usePrinterStore((s) => s.connect)

  const connecting = status === 'connecting'
  const supported = isWebSerialSupported()

  return (
    <Dialog labelledBy="gate-title">
      <h2 id="gate-title" className="text-title">
        Connect your printer
      </h2>

      <BrowserCheck />

      {supported && (
        <>
          <p className="leading-[1.6]">Select the port the printer is connected to.</p>

          <DialogActions>
            <Button variant="primary" block onClick={() => void connect()} disabled={connecting}>
              {connecting ? 'Listening…' : 'Connect'}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
