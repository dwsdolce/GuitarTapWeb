// @parity view/save-sheet
import { useState } from 'react'
import { isValidMeasurementName } from '../measurement/measurementName'

/** Props for {@link SaveSheet}. */
export interface SaveSheetProps {
  /** Pre-fill for the measurement-name field: the loaded measurement's name on re-save, else ""
   *  Mirrors Swift SaveMeasurementSheet `defaultName`. */
  defaultName?: string
  /** Pre-fill for the notes field: the loaded measurement's notes on re-save, else "" — seeds
   *  symmetrically with `defaultName` (Swift SaveMeasurementSheet `defaultNotes`). */
  defaultNotes?: string
  /** Called with the entered name (trimmed, always non-empty) + notes when the user confirms Save. */
  onSave: (name: string, notes: string) => void
  /** Dismiss the sheet (Cancel, backdrop click, or after a successful Save). */
  onClose: () => void
}

/** Name + notes sheet for saving the current frozen measurement to the library. */
export function SaveSheet({ defaultName = '', defaultNotes = '', onSave, onClose }: SaveSheetProps) {
  const [name, setName] = useState(defaultName)
  const [notes, setNotes] = useState(defaultNotes)

  // A name is required: Save is disabled until the field is non-empty after trimming.
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
        </div>
        <div className="settings-body">
          {/* Swift's SaveMeasurementSheet: a bold title above each field, the notes hint under its box. */}
          <label className="form-field">
            <span className="form-label">Measurement Name</span>
            <input
              type="text"
              value={name}
              autoFocus
              placeholder="e.g. Martin 000-28, Spruce Top"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </label>
          <label className="form-field">
            <span className="form-label">Notes (Optional)</span>
            <textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <span className="form-caption">Add any observations about this measurement</span>
          </label>
        </div>
        {/* Cancel / Save sit BELOW the fields, bottom-right — where Swift puts them on macOS
            (a sheet's .cancellationAction/.confirmationAction render in a bottom bar) and where
            Python's trailing button row is. They are a form's confirm/cancel pair, not the
            list-level toolbar actions in a header. */}
        <div className="settings-modal-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {/* Save commits — the accent while it can save, a plain button while it cannot (Swift's
              disabled .confirmationAction), not a faded accent. */}
          <button className={`btn${canSave ? ' btn-primary' : ''}`} onClick={save} disabled={!canSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}