// The custom mode-label editor, an in-page dialog mirroring Swift's CustomModeLabelPopover: a text field,
// Cancel and Assign (Escape and Enter). In-page rather than the browser's own prompt, which makes Safari
// suspend the page's audio.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function CustomLabelDialog({
  initial,
  onAssign,
  onCancel,
}: {
  /** The text the field starts with: the peak's own label when it is the user's, else empty (Swift). */
  initial: string
  onAssign: (label: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const assign = () => {
    const trimmed = draft.trim()
    if (trimmed) onAssign(trimmed)
  }

  return createPortal(
    <div className="settings-overlay" role="dialog" aria-label="Custom Mode Label" onClick={onCancel}>
      <div className="settings-modal alert-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="alert-title">Custom Mode Label</h3>
        <div className="form-field">
          <input
            ref={input}
            type="text"
            aria-label="Custom mode label"
            value={draft}
            placeholder="e.g. Cross Dipole, T(1,0)…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') assign()
              else if (e.key === 'Escape') onCancel()
            }}
          />
        </div>
        <div className="alert-buttons">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={assign} disabled={!draft.trim()}>Assign</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
