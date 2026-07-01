// @parity view/save-sheet
import { useState } from 'react'

export interface SaveSheetProps {
  defaultName?: string
  onSave: (name: string, notes: string) => void
  onClose: () => void
}

/** Name + notes sheet for saving the current frozen measurement to the library. */
export function SaveSheet({ defaultName = '', onSave, onClose }: SaveSheetProps) {
  const [name, setName] = useState(defaultName)
  const [notes, setNotes] = useState('')

  const save = () => {
    onSave(name, notes)
    onClose()
  }

  return (
    <div className="settings-overlay" role="dialog" aria-label="Save Measurement" onClick={onClose}>
      <div className="settings-modal save-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-head">
          <h2>Save Measurement</h2>
          <div className="set-head-buttons">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save}>
              Save
            </button>
          </div>
        </div>
        <div className="settings-body">
          <label className="set-field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              autoFocus
              placeholder="e.g. Contreras Classical"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </label>
          <label className="set-field col">
            <span>Notes</span>
            <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
      </div>
    </div>
  )
}