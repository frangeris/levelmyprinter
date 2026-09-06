import type { ReactNode } from 'react'

interface DialogProps {
  /** id of the heading inside, for `aria-labelledby`. */
  labelledBy: string
  /** Panel overrides — width, or the fixed height a scrolling dialog needs. */
  className?: string
  children: ReactNode
}

/**
 * The modal shell: backdrop, panel, and the stacking order.
 *
 * `z-60` puts it over the fixed strips at 40. That relationship is the only
 * reason either number exists, so they are worth keeping in sight of each other.
 */
export function Dialog({ labelledBy, className = '', children }: DialogProps) {
  return (
    <div
      className="fixed inset-0 z-60 grid place-items-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div
        className={`flex w-[min(440px,100%)] flex-col gap-3 rounded-[4px] bg-surface p-6 shadow-[0_12px_32px_rgb(0_0_0/0.7)] ${className}`}
      >
        {children}
      </div>
    </div>
  )
}

/** Actions row. The spacer pushes everything after it to the right. */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex flex-wrap items-center gap-2">{children}</div>
}

export function DialogSpacer() {
  return <div className="min-w-0 flex-1" />
}

/**
 * An aside inside a dialog. A step darker than the panel, or it disappears into
 * it; `error` when the note is the reason you might not proceed.
 */
export function Note({ children, error }: { children: ReactNode; error?: boolean }) {
  return (
    <p
      className={`rounded-xs px-3 py-2 leading-[1.6] ${
        error ? 'bg-warn-tint text-warn-ink' : 'bg-inset'
      }`}
    >
      {children}
    </p>
  )
}

/** A labelled number field, as used by the preheat and grid-bounds dialogs. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-1 flex-col gap-[6px]">
      <span className="tracking-[0.1em] text-n-600 uppercase">{label}</span>
      {children}
    </label>
  )
}

/** Shared by the text inputs: the terminal's line and the dialogs' numbers. */
export const INPUT =
  'w-full min-h-[36px] rounded-xs border border-divider bg-surface px-[12px] py-[8px] text-ink ' +
  'caret-accent placeholder:text-n-400 hover:border-n-400 focus-visible:border-accent ' +
  'focus-visible:outline-offset-0'
