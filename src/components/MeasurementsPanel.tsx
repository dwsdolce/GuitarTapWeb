import { useEffect, useState } from 'react'
import { listMeasurements, deleteMeasurement, saveMeasurement } from '../measurement/store'
import type { TapToneMeasurementModel } from '../measurement'

export interface MeasurementsPanelProps {
  onClose: () => void
  onLoad: (m: TapToneMeasurementModel) => void
}

const fmtDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

const typeLabel = (m: TapToneMeasurementModel): string =>
  m.spectrumSnapshot?.measurementType ?? (m.comparisonEntries ? 'Comparison' : 'Measurement')

/** The web's measurement library (IndexedDB): list, load into view, rename, delete. */
export function MeasurementsPanel({ onClose, onLoad }: MeasurementsPanelProps) {
  const [items, setItems] = useState<TapToneMeasurementModel[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftNotes, setDraftNotes] = useState('')

  const refresh = () => listMeasurements().then(setItems)
  useEffect(() => {
    void refresh()
  }, [])

  const beginEdit = (m: TapToneMeasurementModel) => {
    setEditing(m.id)
    setDraftName(m.measurementName ?? '')
    setDraftNotes(m.notes ?? '')
  }

  const commitEdit = async (m: TapToneMeasurementModel) => {
    await saveMeasurement({
      ...m,
      measurementName: draftName.trim() || undefined,
      notes: draftNotes.trim() || undefined,
    })
    setEditing(null)
    await refresh()
  }

  const remove = async (m: TapToneMeasurementModel) => {
    if (!window.confirm(`Delete "${m.measurementName ?? 'this measurement'}"? This cannot be undone.`)) return
    await deleteMeasurement(m.id)
    await refresh()
  }

  return (
    <div className="settings-overlay" role="dialog" aria-label="Measurements" onClick={onClose}>
      <div className="settings-modal measurements-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-head">
          <h2>Measurements</h2>
          <div className="set-head-buttons">
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>

        <div className="settings-body">
          {items == null ? (
            <p className="empty">Loading…</p>
          ) : items.length === 0 ? (
            <p className="empty">No saved measurements yet. Capture a tap, then Save.</p>
          ) : (
            <ul className="meas-list">
              {items.map((m) =>
                editing === m.id ? (
                  <li key={m.id} className="meas-row editing">
                    <input
                      type="text"
                      value={draftName}
                      placeholder="Name"
                      autoFocus
                      onChange={(e) => setDraftName(e.target.value)}
                    />
                    <textarea
                      rows={2}
                      value={draftNotes}
                      placeholder="Notes"
                      onChange={(e) => setDraftNotes(e.target.value)}
                    />
                    <div className="meas-actions">
                      <button className="btn mini" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                      <button className="btn mini btn-primary" onClick={() => void commitEdit(m)}>
                        Save
                      </button>
                    </div>
                  </li>
                ) : (
                  <li key={m.id} className="meas-row">
                    <div className="meas-info">
                      <span className="meas-name">{m.measurementName || 'Untitled'}</span>
                      <span className="meas-meta">
                        {typeLabel(m)} · {m.peaks.length} peaks · {fmtDate(m.timestamp)}
                      </span>
                      {m.notes && <span className="meas-notes">{m.notes}</span>}
                    </div>
                    <div className="meas-actions">
                      <button className="btn mini btn-primary" onClick={() => onLoad(m)} title="Load into view">
                        Load
                      </button>
                      <button className="btn mini" onClick={() => beginEdit(m)} title="Rename / edit notes">
                        Edit
                      </button>
                      <button className="btn mini" onClick={() => void remove(m)} title="Delete">
                        Delete
                      </button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}