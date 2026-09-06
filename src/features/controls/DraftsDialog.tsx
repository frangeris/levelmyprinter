import { useRef, useState } from 'react'
import { capturedCount, type SessionPoint } from '../../state/levelingSession.ts'
import { type MeshDraft, saveDraft } from '../../state/meshDrafts.ts'
import type { Leveling } from '../leveling/useLeveling.ts'
import { Button } from '../../ui/Button.tsx'
import { Dialog, DialogActions, DialogSpacer, Note } from '../../ui/Dialog.tsx'

interface DraftsDialogProps {
  points: SessionPoint[]
  leveling: Leveling
  onClose: () => void
}

const filled = (draft: MeshDraft) => draft.z.filter((value) => value !== null).length

const when = (savedAt: number) =>
  new Date(savedAt).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

/**
 * Frozen copies of the grid, kept in this browser.
 *
 * The live session is persisted too, but it is one slot the normal flow keeps
 * overwriting. These are written once and left alone — which is what makes them
 * something to fall back to when a write turns out not to have taken.
 *
 * Nothing here talks to the printer. Restoring puts the values back on the grid
 * and the usual Save-to-printer path writes them, so there stays exactly one
 * route to the machine and it is the one that verifies afterwards.
 */
export function DraftsDialog({ points, leveling, onClose }: DraftsDialogProps) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const { drafts } = leveling
  const captured = capturedCount(points)

  /**
   * Out to a file, because localStorage does not travel.
   *
   * A pass measured on one machine and a browser opened on another is exactly
   * how a mesh gets lost, and the drafts are worth nothing if they only exist
   * where they were made.
   */
  const exportAll = () => {
    const blob = new Blob([JSON.stringify(drafts, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'level-my-printer-measures.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  const importFile = async (file: File) => {
    setProblem(null)
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!Array.isArray(parsed)) throw new Error('not a list of measures')
      // Saved one by one so each goes through the same validation a draft made
      // here would: a file is the least trustworthy input this app takes.
      for (const entry of parsed as MeshDraft[]) saveDraft(entry)
      leveling.refreshDrafts()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'could not be read')
    }
  }

  return (
    <Dialog labelledBy="drafts-title" className="w-[min(600px,100%)]">
      <h2 id="drafts-title" className="text-title">
        Measures
      </h2>
      <p className="leading-[1.6]">
        Saved in this browser, on this machine. One is kept automatically before the app writes to
        the printer and before an auto-level — the two moments values get destroyed.
      </p>

      {drafts.length === 0 ? (
        <Note>
          Nothing saved yet. Save the grid by hand at any point, or let the automatic ones
          accumulate as you work.
        </Note>
      ) : (
        <div className="flex max-h-[320px] flex-col overflow-y-auto [scrollbar-gutter:stable]">
          {drafts.map((draft) => (
            <div
              className="flex items-center gap-3 border-b border-divider px-[2px] py-2"
              key={draft.id}
            >
              <span className="min-w-0 flex-1">
                <span className="block">{draft.label}</span>
                <span className="text-n-600 tabular-nums">
                  {when(draft.savedAt)} · {filled(draft)} of {draft.z.length} points
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Button
                  className="px-[12px] py-[6px]"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    void leveling.restoreDraft(draft.id).then(() => {
                      setBusy(false)
                      onClose()
                    })
                  }}
                >
                  Restore
                </Button>
                <Button
                  variant="ghost"
                  className="py-[6px]"
                  disabled={busy}
                  onClick={() => leveling.removeDraft(draft.id)}
                >
                  Delete
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}

      {captured > 0 && (
        <Note>
          Restoring replaces the {captured} {captured === 1 ? 'value' : 'values'} on the grid now —
          but those get saved as a measure first, so a restore cannot be what loses them.
        </Note>
      )}

      {problem && <Note error>That file {problem}. Nothing was imported.</Note>}

      <input
        ref={fileInput}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
          event.target.value = ''
        }}
      />

      <DialogActions>
        <Button
          variant="ghost"
          disabled={captured === 0}
          title={captured === 0 ? 'Nothing on the grid to save' : undefined}
          onClick={() => leveling.saveDraftNow()}
        >
          Save the grid now
        </Button>
        <Button variant="ghost" disabled={drafts.length === 0} onClick={exportAll}>
          Export
        </Button>
        <Button variant="ghost" onClick={() => fileInput.current?.click()}>
          Import
        </Button>
        <DialogSpacer />
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
