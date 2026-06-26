import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { listMeasurements, deleteMeasurement, saveMeasurement, clearMeasurements } from '../measurement/store'
import { measurementTapToneRatio, guitarTapFilename, newMeasurementId } from '../measurement/fromLive'
import { parseGuitarTapFile, serializeGuitarTapFile, type TapToneMeasurementModel } from '../measurement'
import { MeasurementDetail } from './MeasurementDetail'

export interface MeasurementsPanelProps {
  onClose: () => void
  onLoad: (m: TapToneMeasurementModel) => void
  onCompare: (measurements: TapToneMeasurementModel[]) => void
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
const ICON_EXPORT = ['M12 15V3', 'm7 8 5-5 5 5', 'M5 21h14'] // arrow-up-out (≈ export)
const ICON_DETAILS = ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20', 'M12 16v-4', 'M12 8h.01'] // info-circle (≈ info.circle)

// A measurement is comparable when it has a single-spectrum snapshot and isn't itself a
// comparison — mirrors Swift's `comparableMeasurements` filter.
const isComparable = (m: TapToneMeasurementModel): boolean => m.spectrumSnapshot != null && !isComparison(m)

export function MeasurementsPanel({ onClose, onLoad, onCompare }: MeasurementsPanelProps) {
  const [items, setItems] = useState<TapToneMeasurementModel[] | null>(null)
  const [comparing, setComparing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [menuId, setMenuId] = useState<string | null>(null)
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftNotes, setDraftNotes] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  // Double-press detection works for mouse AND touch via pointer events (single tap is a
  // deliberate no-op, so double-press fires immediately — see the guidelines).
  const lastTap = useRef<{ id: string; t: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

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

  // ── Compare mode (4d) ─────────────────────────────────────────────────────
  const comparableCount = items?.filter(isComparable).length ?? 0
  const enterCompare = () => {
    setMenuId(null)
    setSelected(new Set())
    setComparing(true)
  }
  const exitCompare = () => {
    setComparing(false)
    setSelected(new Set())
  }
  const toggleSelect = (m: TapToneMeasurementModel) => {
    if (!isComparable(m)) return
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(m.id)) n.delete(m.id)
      else n.add(m.id)
      return n
    })
  }
  const openComparison = () => {
    const sel = (items ?? []).filter((m) => selected.has(m.id) && isComparable(m))
    if (sel.length < 2) return
    onCompare(sel) // App builds the comparison, closes the panel
  }

  // Export: write the measurement as a `.guitartap` file (a 1-element JSON array,
  // byte-compatible with the Swift/Python apps). 4c. Uses the File System Access API's
  // save dialog (Chromium) so the user picks the location; falls back to a plain download
  // into the browser's Downloads folder on Safari/Firefox (no API there).
  const exportOne = async (m: TapToneMeasurementModel) => {
    setMenuId(null)
    const data = serializeGuitarTapFile([m])
    const name = guitarTapFilename(m)
    const picker = (
      window as unknown as {
        showSaveFilePicker?: (opts: {
          suggestedName?: string
          types?: { description?: string; accept: Record<string, string[]> }[]
        }) => Promise<{ createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }>
      }
    ).showSaveFilePicker
    if (picker) {
      try {
        const handle = await picker({
          suggestedName: name,
          types: [{ description: 'GuitarTap measurement', accept: { 'application/json': ['.guitartap'] } }],
        })
        const writable = await handle.createWritable()
        await writable.write(data)
        await writable.close()
        return
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return // user cancelled the dialog
        // any other failure → fall through to the download fallback
      }
    }
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  // Import: parse a picked `.guitartap`, add every measurement to the library, and
  // auto-load when the file holds exactly one. 4c.
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null)
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    try {
      const parsed = parseGuitarTapFile(await file.text())
      if (parsed.length === 0) throw new Error('No measurements found in the file.')
      // Fresh id per import so re-importing the same file adds a NEW library entry
      // rather than overwriting by id — mirrors Swift `importMeasurements` (append).
      const imported = parsed.map((m) => ({ ...m, id: newMeasurementId() }))
      for (const m of imported) await saveMeasurement(m)
      await refresh()
      if (imported.length === 1) onLoad(imported[0]!) // auto-load + close
    } catch (err) {
      setImportError(`Couldn't import "${file.name}": ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="settings-overlay" role="dialog" aria-label="Saved Measurements" onClick={onClose}>
      <div className="settings-modal measurements-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-head">
          <h2>Saved Measurements</h2>
          <div className="set-head-buttons">
            {comparing ? (
              <>
                <button
                  className="btn btn-primary"
                  onClick={openComparison}
                  disabled={selected.size < 2}
                  title="Overlay the selected measurements"
                >
                  Compare ({selected.size})
                </button>
                <button className="btn" onClick={exitCompare}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn"
                  onClick={enterCompare}
                  disabled={comparableCount < 2}
                  title="Select measurements to overlay and compare"
                >
                  Compare…
                </button>
                <button className="btn" onClick={() => fileInput.current?.click()} title="Import a .guitartap file">
                  Import…
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".guitartap,application/json"
                  style={{ display: 'none' }}
                  onChange={(e) => void onImportFile(e)}
                />
                {items && items.length > 0 && (
                  <button className="btn" onClick={() => void removeAll()} title="Delete all saved measurements">
                    Delete All
                  </button>
                )}
                <button className="btn btn-primary" onClick={onClose}>
                  Done
                </button>
              </>
            )}
          </div>
        </div>

        <div className="settings-body">
          {importError && <p className="error">⚠ {importError}</p>}
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
                      className={`meas-row${comparing && selected.has(m.id) ? ' selected' : ''}${
                        comparing && !isComparable(m) ? ' disabled' : ''
                      }`}
                      style={{ touchAction: 'manipulation' }}
                      onContextMenu={(e) => {
                        if (comparing) return
                        e.preventDefault()
                        setMenuId(m.id)
                      }}
                    >
                      {comparing && (
                        <span className="meas-check" aria-hidden="true">
                          {!isComparable(m) ? '' : selected.has(m.id) ? '☑' : '☐'}
                        </span>
                      )}
                      <div
                        className="meas-info"
                        onPointerUp={comparing ? undefined : rowPointerUp(m)}
                        onClick={comparing ? () => toggleSelect(m) : undefined}
                        title={comparing ? 'Click to select' : 'Double-click to load'}
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

                      {!comparing && (
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
                      )}
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
              <button role="menuitem" onClick={() => { setMenuId(null); setDetailId(m.id) }}>
                <Icon paths={ICON_DETAILS} />
                View Details
              </button>
              <div className="meas-menu-sep" />
              <button role="menuitem" onClick={() => beginEdit(m)}>
                <Icon paths={ICON_EDIT} />
                Edit Name &amp; Notes
              </button>
              <button role="menuitem" onClick={() => void exportOne(m)}>
                <Icon paths={ICON_EXPORT} />
                Export Measurement
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

      {/* Read-only detail inspector (⋯ → View Details). */}
      {detailId &&
        (() => {
          const m = items?.find((x) => x.id === detailId)
          return m ? <MeasurementDetail measurement={m} onClose={() => setDetailId(null)} /> : null
        })()}
    </div>
  )
}