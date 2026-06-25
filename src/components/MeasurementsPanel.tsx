import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { listMeasurements, deleteMeasurement, saveMeasurement, clearMeasurements } from '../measurement/store'
import { measurementTapToneRatio } from '../measurement/fromLive'
import type { TapToneMeasurementModel } from '../measurement'

export interface MeasurementsPanelProps {
  onClose: () => void
  onLoad: (m: TapToneMeasurementModel) => void
}

// "Saved Measurements" library, following WEB-UI-GUIDELINES.md: double-press a row = Load,
// single click = nothing (a no-op keeps double-press reliable; rows have no standalone
// selected state here), and a right-aligned "⋯" menu (also opened by right-click on
// desktop) holds the per-row actions. Row content mirrors the native MeasurementRowView.
// In-scope actions for 4b: Load into View · Edit Name & Notes · Delete. View Details (4d),
// Export Measurement/Spectrum/PDF (4c / Phase 5) slot into the same menu later.

const fmtDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** "N peaks • Ratio: X.XX • Decay: X.XXs" — only the parts that apply. */
function metaLine(m: TapToneMeasurementModel): string {
  const parts = [`${m.peaks.length} peaks`]
  const ratio = measurementTapToneRatio(m)
  if (ratio != null) parts.push(`Ratio: ${ratio.toFixed(2)}`)
  if (m.decayTime != null) parts.push(`Decay: ${m.decayTime.toFixed(2)}s`)
  return parts.join(' • ')
}

const isComparison = (m: TapToneMeasurementModel): boolean => m.comparisonEntries != null

// Monochrome line icons (Lucide-style) for the ⋯ menu — `currentColor` so they follow
// the menu text colour (and the hover state). Mirrors the Swift SF Symbols.
const Icon = ({ paths }: { paths: string[] }) => (
  <svg className="meas-ico" viewBox="0 0 24 24" aria-hidden="true">
    {paths.map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
)
const ICON_LOAD = ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'] // arrow-down-to-line (≈ arrow.down.doc)
const ICON_EDIT = ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'] // pencil
const ICON_DELETE = ['M3 6h18', 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M10 11v6', 'M14 11v6'] // trash

export function MeasurementsPanel({ onClose, onLoad }: MeasurementsPanelProps) {
  const [items, setItems] = useState<TapToneMeasurementModel[] | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftNotes, setDraftNotes] = useState('')
  // Double-press detection works for mouse AND touch via pointer events (single tap is a
  // deliberate no-op, so double-press fires immediately — see the guidelines).
  const lastTap = useRef<{ id: string; t: number } | null>(null)

  const refresh = () => listMeasurements().then(setItems)
  useEffect(() => {
    void refresh()
  }, [])

  // Close an open row menu on any outside pointer-down. The menu is portaled to <body>, so
  // identify "inside" by class (`.meas-menu` / the row's `.meas-menu-wrap`) rather than DOM
  // ancestry. Also close on Escape.
  useEffect(() => {
    if (!menuId) return
    const close = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest('.meas-menu, .meas-menu-wrap')) return
      setMenuId(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuId(null)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuId])

  const rowPointerUp = (m: TapToneMeasurementModel) => (e: React.PointerEvent) => {
    if (e.button !== 0) return // primary button / touch only
    const now = e.timeStamp
    const prev = lastTap.current
    if (prev && prev.id === m.id && now - prev.t < 350) {
      lastTap.current = null
      onLoad(m)
    } else {
      lastTap.current = { id: m.id, t: now }
    }
  }

  const beginEdit = (m: TapToneMeasurementModel) => {
    setMenuId(null)
    setEditingId(m.id)
    setDraftName(m.measurementName ?? '')
    setDraftNotes(m.notes ?? '')
  }
  const commitEdit = async (m: TapToneMeasurementModel) => {
    await saveMeasurement({
      ...m,
      measurementName: draftName.trim() || undefined,
      notes: draftNotes.trim() || undefined,
    })
    setEditingId(null)
    await refresh()
  }
  const remove = async (m: TapToneMeasurementModel) => {
    setMenuId(null)
    if (!window.confirm(`Delete "${m.measurementName ?? 'this measurement'}"? This cannot be undone.`)) return
    await deleteMeasurement(m.id)
    await refresh()
  }
  const removeAll = async () => {
    if (!window.confirm('Delete ALL saved measurements? This cannot be undone.')) return
    await clearMeasurements()
    await refresh()
  }

  return (
    <div className="settings-overlay" role="dialog" aria-label="Saved Measurements" onClick={onClose}>
      <div className="settings-modal measurements-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-head">
          <h2>Saved Measurements</h2>
          <div className="set-head-buttons">
            {items && items.length > 0 && (
              <button className="btn" onClick={() => void removeAll()} title="Delete all saved measurements">
                Delete All
              </button>
            )}
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
            <>
              <p className="meas-total">
                Total: {items.length} measurement{items.length === 1 ? '' : 's'}
              </p>
              <ul className="meas-list">
                {items.map((m) =>
                  editingId === m.id ? (
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
                        <button className="btn mini" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                        <button className="btn mini btn-primary" onClick={() => void commitEdit(m)}>
                          Save
                        </button>
                      </div>
                    </li>
                  ) : (
                    <li
                      key={m.id}
                      className="meas-row"
                      style={{ touchAction: 'manipulation' }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setMenuId(m.id)
                      }}
                    >
                      <div
                        className="meas-info"
                        onPointerUp={rowPointerUp(m)}
                        title="Double-click to load"
                      >
                        <div className="meas-line1">
                          <span className="meas-name">
                            {m.measurementName || (isComparison(m) ? 'Comparison' : 'Measurement')}
                          </span>
                          {m.spectrumSnapshot && (
                            <span className="meas-wave" title="Has spectrum data" aria-label="Has spectrum">
                              ∿
                            </span>
                          )}
                          <span className="meas-date">{fmtDate(m.timestamp)}</span>
                        </div>
                        <div className="meas-meta">
                          {isComparison(m) ? `${m.comparisonEntries!.length} spectra compared` : metaLine(m)}
                        </div>
                        {m.notes && <div className="meas-notes">{m.notes}</div>}
                      </div>

                      <div className="meas-menu-wrap">
                        <button
                          className="meas-menu-btn"
                          aria-label="Actions"
                          aria-haspopup="menu"
                          onClick={(e) => {
                            if (menuId === m.id) {
                              setMenuId(null)
                            } else {
                              setMenuRect(e.currentTarget.getBoundingClientRect())
                              setMenuId(m.id)
                            }
                          }}
                        >
                          ⋯
                        </button>
                      </div>
                    </li>
                  ),
                )}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* Row actions menu — portaled to <body> with fixed positioning so it floats above
          the (scrollable, short) modal instead of being clipped by it. */}
      {menuId &&
        menuRect &&
        (() => {
          const m = items?.find((x) => x.id === menuId)
          if (!m) return null
          const openUp = menuRect.bottom > window.innerHeight - 170
          const style: CSSProperties = {
            position: 'fixed',
            right: window.innerWidth - menuRect.right,
            ...(openUp ? { bottom: window.innerHeight - menuRect.top + 4 } : { top: menuRect.bottom + 4 }),
          }
          return createPortal(
            <div className="meas-menu" role="menu" style={style} onClick={(e) => e.stopPropagation()}>
              <button role="menuitem" onClick={() => onLoad(m)}>
                <Icon paths={ICON_LOAD} />
                Load into View
              </button>
              <div className="meas-menu-sep" />
              <button role="menuitem" onClick={() => beginEdit(m)}>
                <Icon paths={ICON_EDIT} />
                Edit Name &amp; Notes
              </button>
              <div className="meas-menu-sep" />
              <button role="menuitem" className="danger" onClick={() => void remove(m)}>
                <Icon paths={ICON_DELETE} />
                Delete
              </button>
            </div>,
            document.body,
          )
        })()}
    </div>
  )
}