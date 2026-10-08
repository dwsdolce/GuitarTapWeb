// @parity view/measurement-detail
import { measurementTypeName, comparisonEntryModeFreqs } from '../measurement/fromLive'
import { isComparison, isMaterialMeasurement, effectiveSelectedPeakIDs, type TapToneMeasurementModel } from '../measurement'
import { MODE_DISPLAY_NAME } from '../presentation/modeColors'
import { comparisonRole, cssVariable } from '../presentation/palette'
import { classifyAll, type ResolvedMode } from '../dsp/classify'
import { modeBands } from '../dsp/guitarModes'
import { MATERIAL_PEAK_ROLE_NAME, type MaterialPeakRole } from '../presentation/materialPeakRole'
import { PeakCard } from './PeakCard'
import { ComparisonResultsView, type ComparisonRow } from './ComparisonResultsView'
import { formatDisplayDate } from '../format/date'
import { guitarTypeNameFromRaw, type ResonantPeak } from '../measurement/types'
import { useScheme } from '../hooks/useScheme'

// Read-only measurement inspector — mirrors Swift MeasurementDetailView / Python
// MeasurementDetailDialog. Opened from the Measurements ⋯ menu ("View Details"). A
// lightweight inspector: identity + provenance + the *identified* (selected) results — not a
// full data dump. All mutating actions (Load / Edit / Export / Delete) stay on the row menu.

export interface MeasurementDetailProps {
  measurement: TapToneMeasurementModel
  onClose: () => void
}

/** Swift's GroupBox row: a small secondary "Label:" then the value at body size, left to right. */
function InfoRow({ label, value, name = false }: { label: string; value: string; name?: boolean }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className={`detail-value${name ? ' name' : ''}`}>{value}</span>
    </div>
  )
}

export function MeasurementDetail({ measurement: m, onClose }: MeasurementDetailProps) {
  useScheme() // the colours below are the current scheme's
  const comparison = isComparison(m)

  // Identified Peaks = the SELECTED peaks only (guitar: identified modes / multi-tap averaged;
  // plate/brace: the L/C/FLC peaks). Sorted by frequency.
  // Material (plate/brace) has no per-peak selection: effectiveSelectedPeakIDs returns ALL peaks,
  // ignoring the (possibly corrupted) saved aggregate — mirrors Swift/Python. Guitar uses the selection.
  const selectedIds = effectiveSelectedPeakIDs(m)
  const shownPeaks = m.peaks.filter((p) => selectedIds.has(p.id)).sort((a, b) => a.frequency - b.frequency)

  // Material peaks are labeled by their selected role ID (full words); guitar peaks are RESOLVED
  // (override > classification), never read from the peak's stored `modeLabel`. `modeLabel` is an
  // export-only convenience injected at serialisation time, not stored state, so a loaded file's
  // label may be stale or absent; Swift's MeasurementDetailView derives at display time for the
  // same reason.
  const isMaterial = isMaterialMeasurement(m)
  // Guitar: classified among the SHOWN peaks, as Swift's Details (GuitarMode.classifyAll(shownPeaks)),
  // so overlapping ranges get distinct modes; an override wins for the label.
  const guitarType = guitarTypeNameFromRaw(m.spectrumSnapshot?.guitarType)
  const autoModes = isMaterial ? null : classifyAll(shownPeaks, guitarType)
  const bands = new Map(modeBands(guitarType).map((b) => [b.name, b]))
  const inRangeFor = (p: ResonantPeak, mode: ResolvedMode): boolean | null => {
    if (mode === 'unknown' || mode === 'upper') return null
    const band = bands.get(mode)
    return band ? p.frequency >= band.lo && p.frequency <= band.hi : null
  }
  const materialRoleOf = (p: ResonantPeak): MaterialPeakRole | undefined => {
    if (!isMaterial) return undefined
    if (p.id === m.selectedLongitudinalPeakID) return 'longitudinal'
    if (p.id === m.selectedCrossPeakID) return 'cross'
    if (p.id === m.selectedFlcPeakID) return 'flc'
    return undefined
  }
  const peakLabel = (p: ResonantPeak): string => {
    if (isMaterial) {
      const role = materialRoleOf(p)
      return role ? MATERIAL_PEAK_ROLE_NAME[role] : 'Peak'
    }
    return m.peakModeOverrides?.[p.id] ?? MODE_DISPLAY_NAME[autoModes?.get(p.id) ?? 'unknown']
  }

  const comparisonRows: ComparisonRow[] = comparison
    ? (m.comparisonEntries ?? []).map((e, i) => ({
        label: e.label,
        color: `var(${cssVariable(comparisonRole(i, e.label))})`,
        ...comparisonEntryModeFreqs(e),
      }))
    : []

  return (
    <div className="settings-overlay" role="dialog" aria-label="Measurement Details" onClick={onClose}>
      <div className="settings-modal measurements-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-head">
          <h2>Measurement Details</h2>
          <div className="set-head-buttons phone-only">
            <button className="btn" onClick={onClose}>
              Done
            </button>
          </div>
        </div>

        <div className="settings-body">
          <section className="detail-section">
            <h3>Measurement Info</h3>
            <div className="detail-box detail-info">
            {m.measurementName && <InfoRow label="Measurement Name:" value={m.measurementName} name />}
            <InfoRow label="Date:" value={formatDisplayDate(m.timestamp)} />
            <InfoRow label="Measurement Type:" value={measurementTypeName(m)} />
            {m.numberOfTaps != null && <InfoRow label="Number of Taps:" value={String(m.numberOfTaps)} />}
            {/* No recorded microphone means it is unknown (a played file, say). A comparison has no
                microphone of its own. Mirrors Swift MeasurementDetailView. */}
            {!comparison && <InfoRow label="Microphone:" value={m.microphoneName || 'unknown'} />}
            {m.calibrationName && <InfoRow label="Calibration:" value={m.calibrationName} />}
            {m.notes && (
              <div className="detail-row">
                <span className="detail-label">Notes:</span>
                <span className="detail-value notes">{m.notes}</span>
              </div>
            )}
            </div>
          </section>

          {comparison ? (
            <section className="detail-section">
              <h3>Compared Spectra ({comparisonRows.length})</h3>
              <div className="detail-box">
                <ComparisonResultsView rows={comparisonRows} />
              </div>
            </section>
          ) : (
            <section className="detail-section">
              <h3>Identified Peaks</h3>
              {shownPeaks.length === 0 ? (
                <div className="detail-box">
                  <p className="empty">No identified peaks</p>
                </div>
              ) : (
                <div className="detail-box detail-peaks">
                  {/* The results panel's peak card, read-only (no star, no mode menu) — as Swift's
                      Details reuses CombinedPeakModeRowView. */}
                  {shownPeaks.map((p) => {
                    const mode = autoModes?.get(p.id) ?? 'unknown'
                    const role = materialRoleOf(p)
                    return (
                      <PeakCard
                        key={p.id}
                        peak={p}
                        mode={mode}
                        effectiveLabel={peakLabel(p)}
                        isManualOverride={!isMaterial && m.peakModeOverrides?.[p.id] != null}
                        inRange={isMaterial ? null : inRangeFor(p, mode)}
                        note={p.pitchNote ?? null}
                        cents={p.pitchNote ? p.pitchCents ?? null : null}
                        selected
                        materialRole={role}
                      />
                    )
                  })}
                </div>
              )}
            </section>
          )}
        </div>
        {/* Done at the bottom right, as every form (at the top on a phone): plain, since it only closes. */}
        <div className="settings-modal-foot not-phone">
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}