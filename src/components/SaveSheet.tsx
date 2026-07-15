// @parity view/save-sheet
import { useState } from 'react'
import { isValidMeasurementName } from '../measurement/measurementName'

/** Props for {@link SaveSheet}. */
export interface SaveSheetProps {
  /** Pre-fill for the measurement-name field: the loaded measurement's name on re-save, else ""
   *  (§3). Mirrors Swift SaveMeasurementSheet `defaultName`. */
  defaultName?: string
  /** Called with the entered name (trimmed, always non-empty) + notes when the user confirms Save. */
  onSave: (name: string, notes: string) => void
  /** Dismiss the sheet (Cancel, backdrop click, or after a successful Save). */
  onClose: () => void
}

/** Name + notes sheet for saving the current frozen measurement to the library. */
export function SaveSheet({ defaultName = '', onSave, onClose }: SaveSheetProps) {
  const [name, setName] = useState(defaultName)
  const [notes, setNotes] = useState('')

  // A name is required (§3): Save is disabled until the field is non-empty after trimming.
  const canSave = isValidMeasurementName(name)

  const save = () => {
    if (!canSave) return
    onSave(name.trim(), notes)
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
            <button className="btn btn-primary" onClick={save} disabled={!canSave}>
              Save
            </button>
          </div>
        </div>
        <div className="settings-body">
          <label className="set-field">
            <span>Measurement Name</span>
            <input
              type="text"
              value={name}
              autoFocus
              placeholder="e.g. Martin 000-28, Spruce Top"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </label>
          <label className="set-field col">
            <span>Notes (Optional)</span>
            <textarea
              rows={4}
              value={notes}
              placeholder="Add any observations about this measurement"
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>
      </div>
    </div>
  )
}