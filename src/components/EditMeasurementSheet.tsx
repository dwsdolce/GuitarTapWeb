// @parity view/edit-sheet
//
// Name + notes editor for a measurement already in the library, opened from the row's
// "Edit Name & Notes" action. Mirrors Swift EditMeasurementView and Python EditMeasurementView.
//
// This edition used to edit in place: the row turned into a pair of fields inside the list. On a
// long list that put the thing you were editing wherever the row happened to be — off screen, if
// you had scrolled — and it looked nothing like the toolbar's Save window, which is the other
// place the same two fields are edited. Both natives use a window for both cases, and so does this
// now.
import { useState } from 'react'
import { isAmended } from '../measurement/amend'
import { normalizedMeasurementName, normalizedMeasurementNotes } from '../measurement/measurementName'
import type { TapToneMeasurementModel } from '../measurement/types'

/** Props for {@link EditMeasurementSheet}. */
export interface EditMeasurementSheetProps {
  /** The measurement being amended — seeds the fields and is the baseline for the change test. */
  measurement: TapToneMeasurementModel
  /** Called with the NORMALIZED name and notes when the user confirms Save. */
  onSave: (measurementName: string | undefined, notes: string | undefined) => void
  /** Dismiss without saving (Cancel, backdrop click, or after a successful Save). */
  onClose: () => void
}

export function EditMeasurementSheet({ measurement, onSave, onClose }: EditMeasurementSheetProps) {
  const [name, setName] = useState(measurement.measurementName ?? '')
  const [notes, setNotes] = useState(measurement.notes ?? '')

  // The values Save would write, normalized by the model's own rules — the same ones the save path
  // uses — so the change test compares against what would actually be stored.
  const draftName = normalizedMeasurementName(name)
  const draftNotes = normalizedMeasurementNotes(notes)

  // Save stays disabled until the name or notes actually differ. An amend mints a new dataset id,
  // so a Save that changes nothing would hand unchanged content a new identity. The rule lives in
  // measurement/amend so all three platforms and their tests share one definition.
  const canSave = isAmended(measurement, draftName, draftNotes)

  const save = () => {
    if (!canSave) return
    onSave(draftName, draftNotes)
    onClose()
  }

  return (
    <div className="settings-overlay" role="dialog" aria-label="Edit Measurement" onClick={onClose}>
      <div className="settings-modal save-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-head">
          <h2>Edit Measurement</h2>
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
        <div className="settings-modal-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!canSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
