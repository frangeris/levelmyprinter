import { isWebSerialSupported } from '../../serial/connect.ts'

const isSecure = () => typeof window === 'undefined' || window.isSecureContext

const CODE = 'font-mono'

function Reason({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xs bg-warn-tint px-3 py-2 leading-[1.6] text-warn-ink">
      <b className="font-semibold">{title}</b>
      {children}
    </div>
  )
}

/**
 * `navigator.serial` can be missing for two very different reasons, and
 * conflating them sends the user looking in the wrong place.
 */
export function BrowserCheck() {
  if (isWebSerialSupported()) return null

  // Insecure context: what happens when the app is opened over a network IP
  // without HTTPS. The browser itself may be perfectly capable.
  if (!isSecure()) {
    return (
      <Reason title="Insecure connection: Web Serial is disabled">
        <p>
          You are on <code className={CODE}>{window.location.origin}</code>, which is not a secure
          context. Web Serial only works over HTTPS or on <code className={CODE}>localhost</code>.
        </p>
        <p>
          Start the server with <code className={CODE}>npm run dev:lan</code> and open it over{' '}
          <code className={CODE}>https://</code> (you will have to accept the self-signed
          certificate).
        </p>
      </Reason>
    )
  }

  return (
    <Reason title="This browser does not support Web Serial">
      <p>
        You need desktop Chrome, Edge or Opera, or Firefox 151+. Safari does not support it and
        never will.
      </p>
    </Reason>
  )
}
