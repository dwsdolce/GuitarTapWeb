import { measurementTapToneRatio, comparisonEntryModeFreqs, colorComponentsToCss } from '../measurement/fromLive'
import { isComparison, type TapToneMeasurementModel, type ResonantPeakModel } from '../measurement'
import { MODE_COLOR, MODE_DISPLAY_NAME, magnitudeColor } from './modeColors'
import type { ResolvedMode } from '../dsp/classify'
import { ComparisonResultsView, type ComparisonRow } from './ComparisonResultsView'

// Read-only measurement inspector — mirrors Swift MeasurementDetailView / Python
// MeasurementDetailDialog. Opened from the Measurements ⋯ menu ("View Details"). All
// mutating actions (Load / Edit / Export / Delete) stay on the row menu.

export interface MeasurementDetailProps {
  measurement: TapToneMeasurementModel
  onClose: () => void
}

const fmtDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// Resolve the saved mode-label string to its chart color (guitar modes + material L/C/FLC).
const MATERIAL_LABEL_COLOR: Record<string, string> = {
  Longitudinal: '#4ea1ff',
  'Cross-grain': '#f0a03a',
  FLC: '#b07ad8',
}
function labelColor(label: string | undefined): string {
  if (!label) return 'var(--muted)'
  for (const [mode, name] of Object.entries(MODE_DISPLAY_NAME)) {
    if (name === label) return MODE_COLOR[mode as ResolvedMode]
  }
  return MATERIAL_LABEL_COLOR[label] ?? 'var(--accent)'
}

const pitchText = (p: ResonantPeakModel): string | null => {
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
  const snap = m.spectrumSnapshot ?? m.longitudinalSnapshot
  const measurementType = snap?.measurementType
  const guitarType = snap?.guitarType
  const ratio = measurementTapToneRatio(m)

  // Detected-peaks selection state (selectedPeakIDs, or all peaks when unset).
  const selectedIds = m.selectedPeakIDs?.length ? new Set(m.selectedPeakIDs) : new Set(m.peaks.map((p) => p.id))
  const sortedPeaks = [...m.peaks].sort((a, b) => a.frequency - b.frequency)
  const nSel = sortedPeaks.filter((p) => selectedIds.has(p.id)).length
  const nUnsel = sortedPeaks.length - nSel

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
            {/* Field order mirrors Python MeasurementDetailDialog (a superset of Swift's). */}
            {m.measurementName && <InfoRow label="Measurement Name:" value={m.measurementName} />}
            <InfoRow label="Date:" value={fmtDate(m.timestamp)} />
            {m.decayTime != null && <InfoRow label="Ring-Out:" value={`${m.decayTime.toFixed(2)} s`} />}
            {ratio != null && <InfoRow label="Tap Tone Ratio:" value={`${ratio.toFixed(2)} : 1`} />}
            {measurementType && <InfoRow label="Measurement Type:" value={measurementType} />}
            {guitarType && <InfoRow label="Guitar Type:" value={guitarType} />}
            {m.numberOfTaps != null && <InfoRow label="Number of Taps:" value={String(m.numberOfTaps)} />}
            {m.microphoneName && <InfoRow label="Microphone:" value={m.microphoneName} />}
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
              <h3>
                Detected Peaks ({nSel} selected{nUnsel > 0 ? `, ${nUnsel} unselected` : ''})
              </h3>
              {sortedPeaks.length === 0 ? (
                <p className="empty">No peaks detected.</p>
              ) : (
                <div className="detail-peaks">
                  {sortedPeaks.map((p) => {
                    const sel = selectedIds.has(p.id)
                    const pitch = pitchText(p)
                    return (
                      <div key={p.id} className={`detail-peak${sel ? '' : ' unselected'}`}>
                        <span className="detail-peak-star">{sel ? '★' : '☆'}</span>
                        <div className="detail-peak-body">
                          <div className="detail-peak-line1">
                            <span className="detail-peak-mode" style={{ color: labelColor(p.modeLabel) }}>
                              {p.modeLabel ?? 'Peak'}
                            </span>
                            <span className="detail-peak-freq">{p.frequency.toFixed(1)} Hz</span>
                            {pitch && <span className="detail-peak-pitch">{pitch}</span>}
                          </div>
                          <div className="detail-peak-line2">
                            <span>Q: {p.quality.toFixed(1)}</span>
                            <span>BW: {p.bandwidth.toFixed(1)} Hz</span>
                            <span style={{ color: magnitudeColor(p.magnitude) }}>{p.magnitude.toFixed(1)} dB</span>
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