// @parity view/measurement-detail
import { measurementTypeName, comparisonEntryModeFreqs, colorComponentsToCss, measurementPeakModeLabels } from '../measurement/fromLive'
import { isComparison, isMaterialMeasurement, effectiveSelectedPeakIDs, type TapToneMeasurementModel } from '../measurement'
import { MODE_COLOR, MODE_DISPLAY_NAME, magnitudeColor } from '../presentation/modeColors'
import type { ResolvedMode } from '../dsp/classify'
import { ComparisonResultsView, type ComparisonRow } from './ComparisonResultsView'
import { formatDisplayDate } from '../format/date'
import type { ResonantPeak } from '../measurement/types'
import { FieldPrecision } from '../precision'

// Read-only measurement inspector — mirrors Swift MeasurementDetailView / Python
// MeasurementDetailDialog. Opened from the Measurements ⋯ menu ("View Details"). A
// lightweight inspector: identity + provenance + the *identified* (selected) results — not a
// full data dump. All mutating actions (Load / Edit / Export / Delete) stay on the row menu.

export interface MeasurementDetailProps {
  measurement: TapToneMeasurementModel
  onClose: () => void
}

// Mode-label → chart color (guitar modes + material L/C/FLC).
const MATERIAL_LABEL_COLOR: Record<string, string> = {
  Longitudinal: '#4ea1ff',
  'Cross-grain': '#f0a03a',
  Diagonal: '#b07ad8',
}
function labelColor(label: string): string {
  for (const [mode, name] of Object.entries(MODE_DISPLAY_NAME)) {
    if (name === label) return MODE_COLOR[mode as ResolvedMode]
  }
  return MATERIAL_LABEL_COLOR[label] ?? 'var(--accent)'
}

const pitchText = (p: ResonantPeak): string | null => {
  if (!p.pitchNote) return null
  const cents = p.pitchCents
  if (cents == null) return `♪ ${p.pitchNote}`
  return `♪ ${p.pitchNote} ${cents >= 0 ? '+' : ''}${Math.round(cents)}¢`
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  )
}

export function MeasurementDetail({ measurement: m, onClose }: MeasurementDetailProps) {
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
  const modeLabels = isMaterial ? null : measurementPeakModeLabels(m)
  const peakLabel = (p: ResonantPeak): string => {
    if (isMaterial) {
      if (p.id === m.selectedLongitudinalPeakID) return 'Longitudinal'
      if (p.id === m.selectedCrossPeakID) return 'Cross-grain'
      if (p.id === m.selectedFlcPeakID) return 'Diagonal'
      return 'Peak'
    }
    return modeLabels?.get(p.id) ?? 'Peak'
  }

  const comparisonRows: ComparisonRow[] = comparison
    ? (m.comparisonEntries ?? []).map((e) => ({
        label: e.label,
        color: colorComponentsToCss(e.colorComponents),
        ...comparisonEntryModeFreqs(e),
      }))
    : []

  return (
    <div className="settings-overlay" role="dialog" aria-label="Measurement Details" onClick={onClose}>
      <div className="settings-modal measurements-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-head">
          <h2>Measurement Details</h2>
          <div className="set-head-buttons">
            <button className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="settings-body">
          <section className="detail-section">
            <h3>Measurement Info</h3>
            {m.measurementName && <InfoRow label="Measurement Name:" value={m.measurementName} />}
            <InfoRow label="Date:" value={formatDisplayDate(m.timestamp)} />
            <InfoRow label="Measurement Type:" value={measurementTypeName(m)} />
            {m.numberOfTaps != null && <InfoRow label="Number of Taps:" value={String(m.numberOfTaps)} />}
            {/* No recorded microphone means it is unknown (a played file, say). A comparison has no
                microphone of its own. Mirrors Swift MeasurementDetailView. */}
            {!comparison && <InfoRow label="Microphone:" value={m.microphoneName || 'unknown'} />}
            {m.calibrationName && <InfoRow label="Calibration:" value={m.calibrationName} />}
            {m.notes && (
              <div className="detail-notes">
                <span className="detail-label">Notes:</span>
                <p>{m.notes}</p>
              </div>
            )}
          </section>

          {comparison ? (
            <section className="detail-section">
              <h3>Compared Spectra ({comparisonRows.length})</h3>
              <ComparisonResultsView rows={comparisonRows} />
            </section>
          ) : (
            <section className="detail-section">
              <h3>Identified Peaks</h3>
              {shownPeaks.length === 0 ? (
                <p className="empty">No identified peaks.</p>
              ) : (
                <div className="detail-peaks">
                  {shownPeaks.map((p) => {
                    const label = peakLabel(p)
                    const pitch = pitchText(p)
                    return (
                      <div key={p.id} className="detail-peak">
                        <div className="detail-peak-body">
                          <div className="detail-peak-line1">
                            <span className="detail-peak-mode" style={{ color: labelColor(label) }}>
                              {label}
                            </span>
                            <span className="detail-peak-freq">{FieldPrecision.string(p.frequency, FieldPrecision.peakFrequencyHz)} Hz</span>
                            {pitch && <span className="detail-peak-pitch">{pitch}</span>}
                          </div>
                          <div className="detail-peak-line2">
                            <span>Q: {FieldPrecision.string(p.quality, FieldPrecision.qFactor)}</span>
                            <span>BW: {FieldPrecision.string(p.bandwidth, FieldPrecision.bandwidthHz)} Hz</span>
                            <span style={{ color: magnitudeColor(p.magnitude) }}>{FieldPrecision.string(p.magnitude, FieldPrecision.peakMagnitudeDB)} dB</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}