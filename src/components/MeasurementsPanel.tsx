// @parity view/measurements-list
import { AlertModal } from './AlertModal'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { measurementTapToneRatio, guitarTapFilename } from '../measurement/types'
import { EditMeasurementSheet } from './EditMeasurementSheet'
import { exportStem } from '../measurement/exportFilename'
import { formatDisplayDate } from '../format/date'
import { serializeGuitarTapFile, type TapToneMeasurementModel } from '../measurement'
import { MeasurementDetail } from './MeasurementDetail'
import { menuPlacement } from './menuPlacement'
import { exportFailureMessage, exportSpectrumPng } from '../presentation/spectrumExport'
import { measurementToImageOpts, reportForMeasurement } from '../presentation/measurementImage'
import { saveFile } from '../saveFile'
import { FieldPrecision } from '../precision'
import { WaveformIcon, FileChartIcon, SaveIcon, UploadIcon, TrashIcon, ChevronRightIcon, CheckCircleFillIcon, CircleOutlineIcon, MoreCircleIcon, TrayIcon, FilterIcon, CancelIcon, ChevronDownIcon, MenuItemIcon } from './icons'
import { SAVED_MEASUREMENT_MENU_GROUPS } from '../presentation/savedMeasurementMenu'
import { settingsStore } from '../settingsStore'
import {
  FILTER_TYPES,
  SAVED_MEASUREMENTS_SORTS,
  SAVED_MEASUREMENTS_SORT_TITLE,
  duplicates,
  orderKeys,
  shownOrder,
  type SavedMeasurementsSort,
} from '../measurement/savedMeasurementsOrder'
import { EmptyStateView } from './EmptyStateView'
import { TapToneAnalyzer } from '../state/tapToneAnalyzer'

export interface MeasurementsPanelProps {
  /** The saved measurements, as the model holds them (Swift's list reads `savedMeasurements`). */
  measurements: TapToneMeasurementModel[]
  onClose: () => void
  onLoad: (m: TapToneMeasurementModel) => void
  onCompare: (measurements: TapToneMeasurementModel[]) => void
  /** Import a `.guitartap` file's text; returns the message to show. The MODEL stores,
   *  auto-loads a single measurement, and words it (Swift/Python importAndLoadMeasurements). */
  onImport: (text: string) => Promise<string>
  /** Change a saved measurement's name and notes (the model's `updateMeasurement`). */
  onUpdate: (m: TapToneMeasurementModel, measurementName: string | undefined, notes: string | undefined) => Promise<void>
  /** Remove a saved measurement (the model's `deleteMeasurement`). */
  onDelete: (m: TapToneMeasurementModel) => Promise<void>
  /** Remove every saved measurement (the model's `deleteAllMeasurements`). */
  onDeleteAll: () => Promise<void>
  /** Remove several saved measurements at once (the model's `deleteMeasurements`). */
  onDeleteMany: (ms: TapToneMeasurementModel[]) => Promise<void>
}

// "Saved Measurements" library: double-press a row = Load,
// single click = nothing (a no-op keeps double-press reliable; rows have no standalone
// selected state here), and a right-aligned "⋯" menu (also opened by right-click on
// desktop) holds the per-row actions. Row content mirrors the native MeasurementRowView.
// ⋯ menu (mirrors the native row menu): Load into View · View Details · Edit Name & Notes ·
// Export Measurement · Export Spectrum · Export PDF Report · Delete.

/** "N peaks • Ratio: X.XX • Decay: X.XXs" — only the parts that apply. */
function metaLine(m: TapToneMeasurementModel): string {
  const parts = [`${m.peaks.length} peaks`]
  const ratio = measurementTapToneRatio(m)
  if (ratio != null) parts.push(`Ratio: ${FieldPrecision.string(ratio, FieldPrecision.decayRatio)}`)
  if (m.decayTime != null) parts.push(`Decay: ${FieldPrecision.string(m.decayTime, FieldPrecision.decayTimeS)}s`)
  return parts.join(' • ')
}

const isComparison = (m: TapToneMeasurementModel): boolean => m.comparisonEntries != null


// A measurement is comparable when it has a single-spectrum snapshot and isn't itself a
// comparison — mirrors Swift's `comparableMeasurements` filter.
const isComparable = (m: TapToneMeasurementModel): boolean => m.spectrumSnapshot != null && !isComparison(m)

// Running as an installed PWA? Installed apps are exempt from the browser's storage eviction
// (notably Safari's 7-day purge of script-writable storage, on both macOS and iOS), so the saved-measurements
// library is far more durable. Used to nudge the user to install + keep a backup.
const isInstalled = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (window.navigator as unknown as { standalone?: boolean }).standalone === true

/**
 * The library-local handle for a stored row. Every measurement that came out of the store carries
 * one, so the assertion is safe here; `rowKey` is optional on the model only because a freshly
 * captured or just-parsed measurement has not been stored yet.
 *
 * Rows are addressed by this and never by `id`: `id` is the DATASET identity, which duplicate
 * imports share and which an edit re-mints.
 */
const keyOf = (m: TapToneMeasurementModel): string => m.rowKey as string

export function MeasurementsPanel({ measurements: items, onClose, onLoad, onCompare, onImport, onUpdate, onDelete, onDeleteAll, onDeleteMany }: MeasurementsPanelProps) {
  const [comparing, setComparing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Sort & Filter: what the list shows and in what order; the library keeps its own order (As Added).
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.get)
  const sort = settings.savedMeasurementsSort
  const ascending = settings.savedMeasurementsAscending
  const filter = settings.savedMeasurementsFilter
  // The toolbar's two menus — Sort & Filter and Delete — float above the page like the row ⋯ menu, placed against
  // the button that opened them and opening up or down to fit the window (menuPlacement).
  const [toolMenu, setToolMenu] = useState<{ which: 'sort' | 'delete'; rect: DOMRect } | null>(null)
  const [toolMenuHeight, setToolMenuHeight] = useState<number | null>(null)
  const toolMenuElRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    setToolMenuHeight(toolMenu != null ? (toolMenuElRef.current?.offsetHeight ?? null) : null)
  }, [toolMenu])
  const openToolMenu = (which: 'sort' | 'delete', button: HTMLElement) =>
    setToolMenu((t) => (t?.which === which ? null : { which, rect: button.getBoundingClientRect() }))
  // Delete › Selected…: ticking rows to delete, as compare mode ticks rows to compare.
  const [deleting, setDeleting] = useState(false)
  const [delSelected, setDelSelected] = useState<Set<string>>(new Set())
  const [confirmingDuplicates, setConfirmingDuplicates] = useState(false)
  const [confirmingSelected, setConfirmingSelected] = useState(false)
  const selecting = comparing || deleting
  // The duplicates: every later copy of a measurement already in the library (same id ⟺ same content).
  const duplicateItems = items ? duplicates(items.map((m) => m.id)).map((i) => items[i]!) : []
  const isTicked = (m: TapToneMeasurementModel) => (deleting ? delSelected : selected).has(keyOf(m))
  const toggleDelete = (m: TapToneMeasurementModel) =>
    setDelSelected((s) => {
      const n = new Set(s)
      if (n.has(keyOf(m))) n.delete(keyOf(m))
      else n.add(keyOf(m))
      return n
    })
  const exitDelete = () => {
    setDeleting(false)
    setDelSelected(new Set())
  }
  const confirmDeleteSelected = async () => {
    setConfirmingSelected(false)
    const doomed = (items ?? []).filter((m) => delSelected.has(keyOf(m)))
    exitDelete()
    await onDeleteMany(doomed)
  }
  const confirmDeleteDuplicates = async () => {
    setConfirmingDuplicates(false)
    await onDeleteMany(duplicateItems)
  }
  const shown = items ? shownOrder(orderKeys(items), sort, ascending, filter).map((i) => items[i]!) : []
  /** Choose a sort; choosing the ticked one again reverses it. */
  const chooseSort = (key: SavedMeasurementsSort) => {
    settingsStore.update(key === sort ? { savedMeasurementsAscending: !ascending } : { savedMeasurementsSort: key, savedMeasurementsAscending: true })
    setToolMenu(null)
  }
  /** Show one type, or all (null). A measurement the filter hides cannot stay ticked for a comparison. */
  const setFilter = (value: string | null) => {
    settingsStore.update({ savedMeasurementsFilter: value })
    setToolMenu(null)
    if (items && value != null) {
      const keep = new Set(items.filter((m) => orderKeys([m])[0]!.type === value).map(keyOf))
      setSelected((s) => new Set([...s].filter((k) => keep.has(k))))
      setDelSelected((s) => new Set([...s].filter((k) => keep.has(k))))
    }
  }
  const [menuId, setMenuId] = useState<string | null>(null)
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null)
  // The row menu's own rendered height, measured after it mounts. Its open-up/open-down choice
  // must be made against the REAL height: a hardcoded estimate goes stale the moment a menu item
  // is added, and a too-small one silently clips the menu off the bottom of the window (which is
  // what happened — the estimate said 170px for a ~262px menu, so any row 170–262px from the
  // bottom opened downward and lost "Delete"). null = not measured yet (first paint only).
  const [menuHeight, setMenuHeight] = useState<number | null>(null)
  const menuElRef = useRef<HTMLDivElement | null>(null)

  // Measure the menu once it's in the DOM. useLayoutEffect (not useEffect) runs after mutation but
  // BEFORE paint, so the measure → re-place round trip never reaches the screen: no flicker, even
  // though the first render positions the menu with no height to go on.
  useLayoutEffect(() => {
    setMenuHeight(menuId != null ? (menuElRef.current?.offsetHeight ?? null) : null)
  }, [menuId])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  // An export that failed: the "Export Failed" alert, with Swift's and Python's words.
  const [exportFailure, setExportFailure] = useState<string | null>(null)
  // An import that failed: the "Import Error" alert, with Swift's and Python's words.
  const [importFailure, setImportFailure] = useState<string | null>(null)
  // The import's success message (Swift `importSuccess`, Python's Import Successful box).
  const [importMessage, setImportMessage] = useState<string | null>(null)
  // The measurement awaiting a Delete confirmation, and whether Delete All is. In-page alerts, as Swift's:
  // a browser dialog (window.confirm) makes Safari suspend the page's audio.
  const [pendingDelete, setPendingDelete] = useState<TapToneMeasurementModel | null>(null)
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false)
  // Double-press detection works for mouse AND touch via pointer events (single tap is a
  // deliberate no-op, so double-press fires immediately — see the guidelines).
  const lastTap = useRef<{ id: string; t: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

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
    if (prev && prev.id === keyOf(m) && now - prev.t < 350) {
      lastTap.current = null
      onLoad(m)
    } else {
      lastTap.current = { id: keyOf(m), t: now }
    }
  }

  const beginEdit = (m: TapToneMeasurementModel) => {
    setMenuId(null)
    setEditingId(keyOf(m))
  }
  /** Commit the edit sheet: the model amends the measurement (a new dataset id, the same row). */
  const commitEdit = async (
    m: TapToneMeasurementModel,
    measurementName: string | undefined,
    notes: string | undefined,
  ) => {
    await onUpdate(m, measurementName, notes)
    setEditingId(null)
  }
  const remove = (m: TapToneMeasurementModel) => {
    setMenuId(null)
    setPendingDelete(m)
  }
  const confirmRemove = async () => {
    const m = pendingDelete
    setPendingDelete(null)
    if (!m) return
    await onDelete(m)
  }
  const removeAll = () => setConfirmingDeleteAll(true)
  const confirmRemoveAll = async () => {
    setConfirmingDeleteAll(false)
    await onDeleteAll()
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
      if (n.has(keyOf(m))) n.delete(keyOf(m))
      else n.add(keyOf(m))
      return n
    })
  }
  const openComparison = () => {
    const sel = (items ?? []).filter((m) => selected.has(keyOf(m)) && isComparable(m))
    if (sel.length < 2) return
    onCompare(sel) // App builds the comparison, closes the panel
  }

  // Write a `.guitartap` file (a JSON array of measurements, byte-compatible with the
  // Swift/Python apps). Uses the File System Access save dialog (Chromium) so the user picks
  // the location — including iCloud Drive / Dropbox folders; falls back to a plain download
  // on Safari/Firefox (no API there), where the share sheet still offers "Save to Files".
  const writeGuitarTapFile = (data: string, name: string) =>
    saveFile(data, name, { description: 'GuitarTap measurements', mime: 'application/json', ext: '.guitartap' })

  /** Export one measurement → a 1-element `.guitartap` file (row ⋯ menu). */
  const exportOne = async (m: TapToneMeasurementModel) => {
    setMenuId(null)
    await writeGuitarTapFile(serializeGuitarTapFile([m]), guitarTapFilename(m))
  }

  /** Export a saved measurement's spectrum as a PNG report image (row ⋯ menu). */
  const exportSpectrum = async (m: TapToneMeasurementModel) => {
    setMenuId(null)
    // Saved-measurement export uses the MEASUREMENT's timestamp (matching Swift/Python), not now.
    const ts = Math.floor((Date.parse(m.timestamp) || 0) / 1000)
    const fileName = `${exportStem(m.measurementName, ts, 'spectrum')}.png`
    try {
      await exportSpectrumPng(measurementToImageOpts(m), fileName)
    } catch (err) {
      setExportFailure(exportFailureMessage(err, fileName))
    }
  }

  const exportPdf = async (m: TapToneMeasurementModel) => {
    setMenuId(null)
    let fileName = ''
    try {
      const report = await reportForMeasurement(m)
      fileName = `${report.basename}.pdf`
      await saveFile(report.blob, fileName, { description: 'PDF report', mime: 'application/pdf', ext: '.pdf' })
    } catch (err) {
      // A report that could not be made has no file yet; its error is the drawing's own.
      setExportFailure(exportFailureMessage(err, fileName))
    }
  }

  /** Export the whole library → one `.guitartap` file (group backup / migration). The
   *  importer reads it back as a group; also interops with the native apps' library export. */
  const exportAll = async () => {
    if (!items || items.length === 0) return
    const name = `guitartap-library-${Math.floor(Date.now() / 1000)}.guitartap`
    await writeGuitarTapFile(serializeGuitarTapFile(items), name)
  }

  // Import: parse a picked `.guitartap`, add EVERY measurement to the library (group import),
  // and auto-load only when the file holds exactly one.
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportMessage(null)
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    try {
      // The MODEL imports: it stores every measurement, auto-loads the file that holds exactly one,
      // and words the message — so the message is the same one Swift and Python show, and a load
      // performed by an import is the same load performed from this list.
      const message = await onImport(await file.text())
        setImportMessage(message)
    } catch (err) {
      setImportFailure(TapToneAnalyzer.importErrorMessage(err, file.name))
    }
  }

  // The list's actions with Swift's toolbar icons — at the foot of the sheet, as Swift's bottom bar; at the
  // top on a phone, as Settings.
  const buttons = (
    <>
      {deleting ? (
        <button
          className="btn"
          onClick={() => setConfirmingSelected(true)}
          disabled={delSelected.size === 0}
          title="Delete the selected measurements"
        >
          <TrashIcon />
          Delete ({delSelected.size})
        </button>
      ) : comparing ? (
        <button
          className="btn"
          onClick={openComparison}
          disabled={selected.size < 2}
          title="Overlay the selected measurements"
        >
          <WaveformIcon />
          Compare ({selected.size})
        </button>
      ) : (
        <button
          className="btn"
          onClick={enterCompare}
          disabled={comparableCount < 2}
          title="Select measurements to overlay on a comparison chart"
        >
          <WaveformIcon />
          Compare…
        </button>
      )}
      {/* Sort & Filter — the sort (choosing the ticked one again reverses it, the arrow showing which way) and the
          one type shown. Mirrors Swift SavedMeasurementsSortMenu. */}
      <button
        className="btn"
        onClick={(e) => openToolMenu('sort', e.currentTarget)}
        aria-expanded={toolMenu?.which === 'sort'}
        title="Sort the list, or show one type of measurement"
      >
        <FilterIcon />
        Sort &amp; Filter
        <ChevronDownIcon />
      </button>
      {/* While comparing the other actions stay in place, disabled — as Swift's toolbar. */}
      <button
        className="btn"
        onClick={() => fileInput.current?.click()}
        disabled={selecting}
        title="Import measurements from a .guitartap file (one or many)"
      >
        <SaveIcon />
        Import
      </button>
      {items && items.length > 0 && (
        <button
          className="btn"
          onClick={() => void exportAll()}
          disabled={selecting}
          title="Export the whole library as one .guitartap file (backup / move to another browser or device)"
        >
          <UploadIcon />
          Export All
        </button>
      )}
      {/* Delete — a menu: All…, Duplicates… (disabled when there are none) and Selected… (tick the rows to delete,
          as compare mode does). Mirrors Swift SavedMeasurementsDeleteMenu. */}
      {items && items.length > 0 && (
        <button
          className="btn"
          onClick={(e) => openToolMenu('delete', e.currentTarget)}
          disabled={selecting}
          aria-expanded={toolMenu?.which === 'delete'}
          title="Delete all measurements, the duplicates, or the ones you select"
        >
          <TrashIcon />
          Delete
          <ChevronDownIcon />
        </button>
      )}
      <span className="meas-buttons-gap" />
      {/* Done only closes the list (Cancel leaves compare mode): Swift's .cancellationAction — a plain button. */}
      <button className="btn" onClick={deleting ? exitDelete : comparing ? exitCompare : onClose}>
        {selecting ? 'Cancel' : 'Done'}
      </button>
    </>
  )

  return (
    <div className="settings-overlay" role="dialog" aria-label="Saved Measurements" onClick={onClose}>
      <div className="settings-modal measurements-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-head">
          <h2>Saved Measurements</h2>
          <div className="set-head-buttons meas-buttons phone-only">{buttons}</div>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".guitartap,application/json"
          style={{ display: 'none' }}
          onChange={(e) => void onImportFile(e)}
        />

        {/* Above the list and fixed: the library warning, and the total (or the filter's count) — only the rows
            scroll, as Swift's and Python's lists. */}
        {items != null && items.length > 0 && (
          <div className="meas-fixed">
            {!isInstalled() && items != null && items.length > 0 && (
              <p className="meas-hint">
                ⓘ Your library is stored in this browser and can be cleared by the browser — Safari
                deletes a site's data after about 7 days without a visit (on macOS and iOS alike). <b>Install the app</b> (Add to Home Screen / Add to Dock) for
                durable storage, and use <b>Export All</b> to keep a backup.
              </p>
            )}
            {filter != null ? (
              <p className="meas-total meas-filtered">
                Showing {shown.length} of {items.length} · {filter}
                <button className="btn-icon" onClick={() => setFilter(null)} aria-label="Show all measurements" title="Show all measurements">
                  <CancelIcon />
                </button>
              </p>
            ) : (
              <p className="meas-total">
                Total: {items.length} measurement{items.length === 1 ? '' : 's'}
              </p>
            )}
          </div>
        )}
        <div className="settings-body">
          {exportFailure && (
            <AlertModal
              title="Export Failed"
              message={exportFailure}
              buttons={[{ label: 'OK', primary: true, onClick: () => setExportFailure(null) }]}
              onDismiss={() => setExportFailure(null)}
            />
          )}
          {importFailure && (
            <AlertModal
              title="Import Error"
              message={importFailure}
              buttons={[{ label: 'OK', primary: true, onClick: () => setImportFailure(null) }]}
              onDismiss={() => setImportFailure(null)}
            />
          )}
          {/* The import's one message, as the natives show it: an "Import Successful" alert over
              the list, dismissed with OK (Swift MeasurementsListView `.alert("Import Successful")`,
              Python's Import Successful box). Rendered inside the panel so dismissing it leaves the
              list open underneath, as both natives do. */}
          {importMessage && (
            <AlertModal
              title="Import Successful"
              message={importMessage}
              buttons={[{ label: 'OK', primary: true, onClick: () => setImportMessage(null) }]}
              onDismiss={() => setImportMessage(null)}
            />
          )}
          {pendingDelete && (
            <AlertModal
              title="Delete Measurement?"
              message={`Are you sure you want to delete "${pendingDelete.measurementName ?? 'Measurement'}"? This cannot be undone.`}
              buttons={[
                { label: 'Cancel', onClick: () => setPendingDelete(null) },
                { label: 'Delete', primary: true, onClick: () => void confirmRemove() },
              ]}
              onDismiss={() => setPendingDelete(null)}
            />
          )}
          {confirmingDuplicates && (
            <AlertModal
              title="Delete Duplicates?"
              message={`This will delete ${duplicateItems.length} duplicate measurement${duplicateItems.length === 1 ? '' : 's'}; the first copy of each is kept.`}
              buttons={[
                { label: 'Cancel', onClick: () => setConfirmingDuplicates(false) },
                { label: 'Delete', primary: true, onClick: () => void confirmDeleteDuplicates() },
              ]}
              onDismiss={() => setConfirmingDuplicates(false)}
            />
          )}
          {confirmingSelected && (
            <AlertModal
              title="Delete Selected Measurements?"
              message={`This will permanently delete ${delSelected.size} measurement${delSelected.size === 1 ? '' : 's'}. This cannot be undone.`}
              buttons={[
                { label: 'Cancel', onClick: () => setConfirmingSelected(false) },
                { label: 'Delete', primary: true, onClick: () => void confirmDeleteSelected() },
              ]}
              onDismiss={() => setConfirmingSelected(false)}
            />
          )}
          {confirmingDeleteAll && (
            <AlertModal
              title="Delete All Measurements?"
              message={`This will permanently delete all ${items?.length ?? 0} saved measurement${items?.length === 1 ? '' : 's'}. This cannot be undone.`}
              buttons={[
                { label: 'Cancel', onClick: () => setConfirmingDeleteAll(false) },
                { label: 'Delete All', primary: true, onClick: () => void confirmRemoveAll() },
              ]}
              onDismiss={() => setConfirmingDeleteAll(false)}
            />
          )}
          {items.length === 0 ? (
            <EmptyStateView
              icon={<TrayIcon size={60} />}
              title="No Saved Measurements"
              message="Tap the guitar and click Save to store measurements for comparison."
            />
          ) : (
            <>
              <ul className="meas-list">
                {shown.map((m) => (
                  <li
                      key={keyOf(m)}
                      className={`meas-row${selecting && isTicked(m) ? ' selected' : ''}${
                        comparing && !isComparable(m) ? ' disabled' : ''
                      }`}
                      style={{ touchAction: 'manipulation' }}
                      onContextMenu={(e) => {
                        if (selecting) return
                        e.preventDefault()
                        setMenuId(keyOf(m))
                      }}
                    >
                      {selecting && (
                        // Swift's circle / checkmark.circle.fill — shown on every row; a row that can't be
                        // compared is dimmed with it (any row can be deleted).
                        <span className={`meas-check${isTicked(m) ? ' on' : ''}`} aria-hidden="true">
                          {isTicked(m) ? <CheckCircleFillIcon /> : <CircleOutlineIcon />}
                        </span>
                      )}
                      <div
                        className="meas-info"
                        onPointerUp={selecting ? undefined : rowPointerUp(m)}
                        onClick={deleting ? () => toggleDelete(m) : comparing ? () => toggleSelect(m) : undefined}
                        title={
                          deleting
                            ? 'Toggle selection for deletion'
                            : comparing
                              ? 'Toggle selection for comparison'
                              : 'Double-click to load measurement'
                        }
                      >
                        <div className="meas-line1">
                          <span className="meas-name">
                            {m.measurementName || (isComparison(m) ? 'Comparison' : 'Measurement')}
                          </span>
                          {/* Swift's marks beside the date: a comparison's chart document in the accent, a
                              measurement's waveform (it has a spectrum) in status.complete. */}
                          {isComparison(m) ? (
                            <span className="meas-mark comparison" title="Comparison record" aria-label="Comparison">
                              <FileChartIcon />
                            </span>
                          ) : (
                            m.spectrumSnapshot && (
                              <span className="meas-mark meas-wave" title="Has spectrum data" aria-label="Has spectrum">
                                <WaveformIcon />
                              </span>
                            )
                          )}
                          <span className="meas-date">{formatDisplayDate(m.timestamp)}</span>
                          <span className="meas-chevron" aria-hidden="true">
                            <ChevronRightIcon />
                          </span>
                        </div>
                        <div className="meas-meta">
                          {isComparison(m) ? `${m.comparisonEntries!.length} spectra compared` : metaLine(m)}
                        </div>
                        {m.notes && <div className="meas-notes">{m.notes}</div>}
                      </div>

                      {!selecting && (
                        <div className="meas-menu-wrap">
                          <button
                            className="meas-menu-btn btn-icon"
                            aria-label="Actions"
                            title="Actions"
                            aria-haspopup="menu"
                            aria-expanded={menuId === keyOf(m)}
                            onClick={(e) => {
                              if (menuId === keyOf(m)) {
                                setMenuId(null)
                              } else {
                                setMenuRect(e.currentTarget.getBoundingClientRect())
                                setMenuId(keyOf(m))
                              }
                            }}
                          >
                            <MoreCircleIcon />
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
        <div className="settings-modal-foot meas-buttons not-phone">{buttons}</div>
      </div>

      {toolMenu &&
        createPortal(
          <>
            {/* Portaled, but React still passes its clicks up to the panel's overlay, which closes the panel on a
                click — so both stop them, as the row ⋯ menu does: a click closes only the menu. */}
            <div
              className="meas-sort-backdrop"
              onClick={(e) => {
                e.stopPropagation()
                setToolMenu(null)
              }}
            />
            <div
              className="meas-menu"
              role="menu"
              ref={toolMenuElRef}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'fixed',
                left: Math.max(8, Math.min(toolMenu.rect.left, window.innerWidth - 220)),
                ...menuPlacement(toolMenu.rect, toolMenuHeight),
              }}
            >
              {toolMenu.which === 'sort' ? (
                <>
                  <span className="meas-menu-head">Sort by</span>
                  {SAVED_MEASUREMENTS_SORTS.map((key) => (
                    <button key={key} role="menuitemradio" aria-checked={key === sort} onClick={() => chooseSort(key)}>
                      <span className="meas-tick">{key === sort ? '✓' : ''}</span>
                      {SAVED_MEASUREMENTS_SORT_TITLE[key]}
                      {key === sort && <span className="meas-dir">{ascending ? '↑' : '↓'}</span>}
                    </button>
                  ))}
                  <span className="meas-menu-sep" />
                  <span className="meas-menu-head">Show</span>
                  {[null, ...FILTER_TYPES].map((t) => (
                    <button key={t ?? 'all'} role="menuitemradio" aria-checked={t === filter} onClick={() => setFilter(t)}>
                      <span className="meas-tick">{t === filter ? '✓' : ''}</span>
                      {t ?? 'All'}
                    </button>
                  ))}
                </>
              ) : (
                <>
                  <button role="menuitem" onClick={() => { setToolMenu(null); removeAll() }}>All…</button>
                  <button
                    role="menuitem"
                    disabled={duplicateItems.length === 0}
                    onClick={() => { setToolMenu(null); setConfirmingDuplicates(true) }}
                  >
                    Duplicates…
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => { setToolMenu(null); setMenuId(null); setDelSelected(new Set()); setDeleting(true) }}
                  >
                    Selected…
                  </button>
                </>
              )}
            </div>
          </>,
          document.body,
        )}

      {/* Row actions menu — portaled to <body> with fixed positioning so it floats above
          the (scrollable, short) modal instead of being clipped by it. */}
      {menuId &&
        menuRect &&
        (() => {
          const m = items?.find((x) => keyOf(x) === menuId)
          if (!m) return null
          const style: CSSProperties = {
            position: 'fixed',
            right: window.innerWidth - menuRect.right,
            ...menuPlacement(menuRect, menuHeight),
          }
          return createPortal(
            <div
              className="meas-menu"
              role="menu"
              ref={menuElRef}
              style={style}
              onClick={(e) => e.stopPropagation()}
            >
              {/* From its groups (SAVED_MEASUREMENT_MENU_GROUPS), a separator between them; an ordinary item
                  carries no colour of its own, Delete included (style guide S1a). */}
              {SAVED_MEASUREMENT_MENU_GROUPS.map((group, gi) => (
                <Fragment key={gi}>
                  {gi > 0 && <div className="meas-menu-sep" />}
                  {group.map((entry) => (
                    <button
                      key={entry.action}
                      role="menuitem"
                      onClick={() => {
                        switch (entry.action) {
                          case 'load': onLoad(m); break
                          case 'details': setMenuId(null); setDetailId(keyOf(m)); break
                          case 'edit': beginEdit(m); break
                          case 'exportMeasurement': void exportOne(m); break
                          case 'exportSpectrum': void exportSpectrum(m); break
                          case 'exportPDF': void exportPdf(m); break
                          case 'delete': remove(m); break
                        }
                      }}
                    >
                      <span className="meas-ico"><MenuItemIcon mdi={entry.mdi} /></span>
                      {entry.title}
                    </button>
                  ))}
                </Fragment>
              ))}
            </div>,
            document.body,
          )
        })()}

      {/* Read-only detail inspector (⋯ → View Details). */}
      {detailId &&
        (() => {
          const m = items?.find((x) => keyOf(x) === detailId)
          return m ? <MeasurementDetail measurement={m} onClose={() => setDetailId(null)} /> : null
        })()}

      {/* Edit Name & Notes — a window, like the toolbar's Save and like both natives. */}
      {editingId &&
        (() => {
          const m = items?.find((x) => keyOf(x) === editingId)
          return m ? (
            <EditMeasurementSheet
              measurement={m}
              onSave={(name, notes) => void commitEdit(m, name, notes)}
              onClose={() => setEditingId(null)}
            />
          ) : null
        })()}
    </div>
  )
}