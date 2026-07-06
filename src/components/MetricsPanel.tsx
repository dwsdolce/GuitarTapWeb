// @parity view/analysis-metrics
// FFT analysis metrics panel — mirrors the native FFTAnalysisMetricsView.
// Three GroupBoxes (Analysis Configuration / Performance / Peak Detection) plus a
// running/stopped status indicator. The values are computed in App from the live
// engine + spectrum; this component only formats them.

export interface Metrics {
  /** Hz per FFT bin (sampleRate / FFT size). */
  frequencyResolution: number | null
  /** FFT output bins in the captured guitar spectrum, or null in material/live-only. */
  binCount: number | null
  /** Hardware capture rate (Hz). */
  sampleRate: number | null
  /** 0 Hz → Nyquist (Hz). */
  bandwidth: number | null
  /** FFT time-window duration (seconds). */
  sampleLengthSeconds: number | null
  /** Continuous FFT calculations per second. */
  frameRate: number | null
  /** Last continuous-FFT wall-clock (ms). */
  processingTimeMs: number | null
  /** 30-frame moving average of the FFT wall-clock (ms). */
  avgProcessingTimeMs: number | null
  /** Dominant frequency of the displayed spectrum (Hz). */
  peakFrequency: number | null
  /** Magnitude at the dominant frequency (dB). */
  peakMagnitude: number | null
  /** Whether the engine is actively analyzing. */
  isRunning: boolean
}

export interface MetricsPanelProps {
  metrics: Metrics
  onClose: () => void
}

const DASH = '—'

function freq(hz: number | null): string {
  if (hz == null) return DASH
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(1)} Hz`
}

function MetricRow({ label, value, subtitle }: { label: string; value: string; subtitle: string }) {
  return (
    <div className="metric-row">
      <div className="metric-label">
        <span className="metric-name">{label}</span>
        <span className="metric-subtitle">{subtitle}</span>
      </div>
      <span className="metric-value">{value}</span>
    </div>
  )
}

export function MetricsPanel({ metrics: m, onClose }: MetricsPanelProps) {
  // CPU headroom: average processing time as a fraction of the available frame budget.
  const frameTimeMs = m.frameRate ? 1000 / m.frameRate : null
  const cpuUsage =
    m.avgProcessingTimeMs != null && frameTimeMs ? (m.avgProcessingTimeMs / frameTimeMs) * 100 : null

  return (
    <div className="settings-overlay" role="dialog" aria-label="Analysis Metrics" onClick={onClose}>
      <div className="settings-modal metrics-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-head">
          <h2>Analysis Metrics</h2>
          <div className="set-head-buttons">
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>

        <div className="settings-body">
          <section className="metric-group">
            <h3>Analysis Configuration</h3>
            <MetricRow label="Frequency Resolution" value={freq(m.frequencyResolution)} subtitle="Hz per bin" />
            <MetricRow
              label="Bin Count"
              value={m.binCount != null ? m.binCount.toLocaleString() : DASH}
              subtitle="FFT output bins (guitar mode only)"
            />
            <MetricRow
              label="Sample Rate"
              value={m.sampleRate ? `${Math.round(m.sampleRate).toLocaleString()} Hz` : DASH}
              subtitle="Hardware capture rate"
            />
            <MetricRow label="Bandwidth" value={freq(m.bandwidth)} subtitle="0 Hz to Nyquist" />
            <MetricRow
              label="Sample Length"
              value={m.sampleLengthSeconds != null ? `${m.sampleLengthSeconds.toFixed(2)} s` : DASH}
              subtitle="Time window duration"
            />
            <MetricRow
              label="Frame Rate"
              value={m.frameRate != null ? `${m.frameRate.toFixed(1)} Hz` : DASH}
              subtitle="FFT calculations/sec"
            />
          </section>

          <section className="metric-group">
            <h3>Performance</h3>
            <MetricRow
              label="Processing Time"
              value={m.processingTimeMs != null ? `${m.processingTimeMs.toFixed(3)} ms` : DASH}
              subtitle="Last frame"
            />
            <MetricRow
              label="Average Processing"
              value={m.avgProcessingTimeMs != null ? `${m.avgProcessingTimeMs.toFixed(3)} ms` : DASH}
              subtitle="30-frame average"
            />
            <MetricRow
              label="CPU Usage"
              value={cpuUsage != null ? `${cpuUsage.toFixed(1)}%` : DASH}
              subtitle="Of available frame time"
            />
          </section>

          <section className="metric-group">
            <h3>Peak Detection</h3>
            <MetricRow label="Peak Frequency" value={freq(m.peakFrequency)} subtitle="Dominant frequency" />
            <MetricRow
              label="Peak Magnitude"
              value={m.peakMagnitude != null ? `${m.peakMagnitude.toFixed(1)} dB` : DASH}
              subtitle="Signal strength"
            />
          </section>

          <div className="metric-status">
            <span className={`metric-dot ${m.isRunning ? 'on' : 'off'}`} />
            <span>{m.isRunning ? 'Analyzing' : 'Stopped'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}