import { useRef, useState } from 'react'
import type { StoredCalibration } from '../measurement/calibrationStore'
import { densityGPerCm3, type Dimensions } from '../dsp/material'
import { modeBands } from '../dsp/guitarModes'
import {
  ANALYSIS_KEYS,
  DEFAULT_SETTINGS,
  DISPLAY_KEYS,
  MEASUREMENT_FULL_NAME,
  MEASUREMENT_TYPES,
  STIFFNESS_LABEL,
  defaultDisplayRange,
  displayRangeFor,
  setDisplayRangePatch,
  isGuitarType,
  type MeasurementType,
  type Settings,
  type StiffnessPreset,
} from '../settings'
import type { ChartView } from '../presentation/chartTypes'
import { MODE_DISPLAY_NAME } from '../presentation/modeColors'

export interface SettingsPanelProps {
  settings: Settings
  sampleRate: number | null
  deviceLabel: string
  /** The chart's current zoom — captured by Save Current View. */
  currentView: ChartView
  /** Apply the edited settings (Done). */
  onApply: (settings: Settings) => void
  /** Persist the current chart view as the display range — takes effect immediately
   *  (like Swift saveCurrentView), independent of Done/Cancel. */
  onSaveCurrentView: () => void
  /** Close without applying (Cancel / backdrop). */
  onClose: () => void
  // ── Audio Input & Calibration (apply IMMEDIATELY, independent of Done/Cancel) ──
  /** Available audio input devices (enumerated once mic permission is granted). */
  inputDevices: { deviceId: string; label: string }[]
  /** deviceId of the active input, or null. */
  currentDeviceId: string | null
  /** Switch the live input device. */
  onSelectDevice: (deviceId: string) => void
  /** Imported calibration profiles. */
  calibrations: StoredCalibration[]
  /** id of the active calibration, or null for None. */
  activeCalibrationId: string | null
  /** Import a calibration file (UMIK-1 / REW .cal/.txt). */
  onImportCalibration: (file: File) => void
  /** Make a stored calibration active (or None when null). */
  onSelectCalibration: (id: string | null) => void
  /** Delete a stored calibration profile. */
  onDeleteCalibration: (id: string) => void
}

const STIFFNESS_PRESETS: StiffnessPreset[] = [
  'steelStringTop',
  'steelStringBack',
  'classicalTop',
  'classicalBack',
  'custom',
]

function NumberField({
  label,
  unit,
  value,
  onChange,
  step = 1,
}: {
  label: string
  unit: string
  value: number
  onChange: (v: number) => void
  step?: number
}) {
  return (
    <label className="set-field">
      <span>{label}</span>
      <span className="set-input">
        <input type="number" value={value} step={step} onChange={(e) => onChange(Number(e.target.value))} />
        {unit && <em>{unit}</em>}
      </span>
    </label>
  )
}

/** A min/max range row (Frequency Range, Magnitude Range, Analysis Range). */
function RangeField({
  title,
  description,
  unit,
  min,
  max,
  onMin,
  onMax,
}: {
  title: string
  description: string
  unit: string
  min: number
  max: number
  onMin: (v: number) => void
  onMax: (v: number) => void
}) {
  return (
    <div className="set-range">
      <div className="set-range-title">{title}</div>
      <div className="set-range-inputs">
        <span className="set-input">
          <input type="number" value={min} onChange={(e) => onMin(Number(e.target.value))} />
          <em>{unit}</em>
        </span>
        <span className="set-range-dash">–</span>
        <span className="set-input">
          <input type="number" value={max} onChange={(e) => onMax(Number(e.target.value))} />
          <em>{unit}</em>
        </span>
      </div>
      <p className="set-desc">{description}</p>
    </div>
  )
}

export function SettingsPanel({
  settings,
  sampleRate,
  deviceLabel,
  currentView,
  onApply,
  onSaveCurrentView,
  onClose,
  inputDevices,
  currentDeviceId,
  onSelectDevice,
  calibrations,
  activeCalibrationId,
  onImportCalibration,
  onSelectCalibration,
  onDeleteCalibration,
}: SettingsPanelProps) {
  const calFileInput = useRef<HTMLInputElement>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  // Buffered edits — applied on Done, discarded on Cancel (mirrors Swift's dialog).
  const [d, setD] = useState<Settings>(settings)
  const patch = (p: Partial<Settings>) => setD((cur) => ({ ...cur, ...p }))

  const plateDims: Dimensions = {
    lengthMm: d.plateLength,
    widthMm: d.plateWidth,
    thicknessMm: d.plateThickness,
    massG: d.plateMass,
  }
  const braceDims: Dimensions = {
    lengthMm: d.braceLength,
    widthMm: d.braceWidth,
    thicknessMm: d.braceThickness,
    massG: d.braceMass,
  }

  const resetKeys = (keys: readonly (keyof Settings)[]) => {
    const p: Partial<Settings> = {}
    for (const k of keys) (p as Record<string, unknown>)[k] = DEFAULT_SETTINGS[k]
    patch(p)
  }

  // Reset the Display group: dB axis to factory + the CURRENT measurement type's
  // frequency range to its per-type default (other types' saved ranges are kept).
  const resetDisplay = () => {
    const p: Partial<Settings> = {}
    for (const k of DISPLAY_KEYS) (p as Record<string, unknown>)[k] = DEFAULT_SETTINGS[k]
    patch({ ...p, ...setDisplayRangePatch(d, d.measurementType, defaultDisplayRange(d.measurementType)) })
  }

  // Save Current View persists immediately (Swift behavior) AND reflects into the draft
  // so Done doesn't revert it and the range fields update.
  const saveCurrentView = () => {
    onSaveCurrentView()
    patch({
      ...setDisplayRangePatch(d, d.measurementType, {
        minHz: Math.round(currentView.minHz),
        maxHz: Math.round(currentView.maxHz),
      }),
      minDb: Math.round(currentView.minDb),
      maxDb: Math.round(currentView.maxDb),
    })
  }

  const done = () => {
    onApply(d)
    onClose()
  }

  return (
    <div className="settings-overlay" role="dialog" aria-label="Settings" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-head">
          <h2>Settings</h2>
          <div className="set-head-buttons">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={done}>
              Done
            </button>
          </div>
        </div>

        <div className="settings-body">
          {/* ── Audio Input & Calibration (applies immediately — not buffered) ── */}
          <section>
            <h3>Audio Input &amp; Calibration</h3>
            <label className="set-field">
              <span>Device</span>
              <select
                className="set-input-select"
                value={currentDeviceId ?? ''}
                onChange={(e) => onSelectDevice(e.target.value)}
                disabled={inputDevices.length === 0}
              >
                {inputDevices.length === 0 && <option value="">{deviceLabel || 'Default input'}</option>}
                {inputDevices.map((dvc, i) => (
                  <option key={dvc.deviceId} value={dvc.deviceId}>
                    {dvc.label || `Microphone ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="set-readout">
              Sample rate <b>{sampleRate ? `${(sampleRate / 1000).toFixed(1)} kHz` : '—'}</b>
            </div>
            <label className="set-field">
              <span>Calibration</span>
              <select
                className="set-input-select"
                value={activeCalibrationId ?? ''}
                onChange={(e) => onSelectCalibration(e.target.value || null)}
              >
                <option value="">None (flat)</option>
                {calibrations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="set-cal-actions">
              <button className="btn mini" onClick={() => calFileInput.current?.click()}>
                Import…
              </button>
              {activeCalibrationId && (
                <button className="btn mini danger" onClick={() => onDeleteCalibration(activeCalibrationId)}>
                  Delete
                </button>
              )}
              <input
                ref={calFileInput}
                type="file"
                accept=".cal,.txt,text/plain"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) onImportCalibration(f)
                }}
              />
            </div>
            <p className="set-note">
              Applied immediately (not via Done). Import a UMIK-1 / REW calibration file; corrections
              are added to the spectrum and remembered for this microphone.
            </p>
          </section>

          {/* ── Measurement Type (with type-conditional inputs nested) ── */}
          <section>
            <h3>Measurement Type</h3>
            <select
              className="set-select"
              value={d.measurementType}
              onChange={(e) => patch({ measurementType: e.target.value as MeasurementType })}
            >
              {MEASUREMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MEASUREMENT_FULL_NAME[t]}
                </option>
              ))}
            </select>

            {isGuitarType(d.measurementType) && (
              <>
                <h4>Mode Ranges</h4>
                <table className="mode-range-table">
                  <tbody>
                    {modeBands(d.measurementType).map((b) => (
                      <tr key={b.name}>
                        <td>{MODE_DISPLAY_NAME[b.name]}</td>
                        <td>
                          {b.lo} – {b.hi} Hz
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {d.measurementType === 'plate' && (
              <>
                <h4>Plate</h4>
                <NumberField label="Length (along grain)" unit="mm" value={d.plateLength} onChange={(v) => patch({ plateLength: v })} />
                <NumberField label="Width (cross grain)" unit="mm" value={d.plateWidth} onChange={(v) => patch({ plateWidth: v })} />
                <NumberField label="Thickness" unit="mm" value={d.plateThickness} step={0.1} onChange={(v) => patch({ plateThickness: v })} />
                <NumberField label="Mass" unit="g" value={d.plateMass} step={0.1} onChange={(v) => patch({ plateMass: v })} />
                <div className="set-readout">
                  Density <b>{densityGPerCm3(plateDims).toFixed(3)}</b> g/cm³
                </div>

                <label className="set-field">
                  <span>Stiffness preset</span>
                  <select
                    className="set-input-select"
                    value={d.plateStiffnessPreset}
                    onChange={(e) => patch({ plateStiffnessPreset: e.target.value as StiffnessPreset })}
                  >
                    {STIFFNESS_PRESETS.map((p) => (
                      <option key={p} value={p}>
                        {STIFFNESS_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </label>
                {d.plateStiffnessPreset === 'custom' && (
                  <NumberField label="Custom stiffness" unit="" value={d.customPlateStiffness} onChange={(v) => patch({ customPlateStiffness: v })} />
                )}

                <label className="set-field check">
                  <input type="checkbox" checked={d.measureFlc} onChange={(e) => patch({ measureFlc: e.target.checked })} />
                  <span>Measure F_LC (shear modulus)</span>
                </label>

                <h4>Gore body dimensions</h4>
                <NumberField label="Body length" unit="mm" value={d.guitarBodyLength} onChange={(v) => patch({ guitarBodyLength: v })} />
                <NumberField label="Body width" unit="mm" value={d.guitarBodyWidth} onChange={(v) => patch({ guitarBodyWidth: v })} />
              </>
            )}

            {d.measurementType === 'brace' && (
              <>
                <h4>Brace</h4>
                <NumberField label="Length" unit="mm" value={d.braceLength} onChange={(v) => patch({ braceLength: v })} />
                <NumberField label="Width" unit="mm" value={d.braceWidth} onChange={(v) => patch({ braceWidth: v })} />
                <NumberField label="Thickness" unit="mm" value={d.braceThickness} step={0.1} onChange={(v) => patch({ braceThickness: v })} />
                <NumberField label="Mass" unit="g" value={d.braceMass} step={0.1} onChange={(v) => patch({ braceMass: v })} />
                <div className="set-readout">
                  Density <b>{densityGPerCm3(braceDims).toFixed(3)}</b> g/cm³
                </div>
              </>
            )}
          </section>

          {/* ── Advanced (collapsible) ───────────────────────── */}
          <section>
            <button className="set-disclosure" onClick={() => setShowAdvanced((v) => !v)}>
              <span>{showAdvanced ? '▾' : '▸'}</span> Advanced
            </button>

            {showAdvanced && (
              <>
                <h4>Display Settings</h4>
                <RangeField
                  title="Frequency Range"
                  description={`Frequency range shown in the spectrum chart for ${MEASUREMENT_FULL_NAME[d.measurementType]} (saved per measurement type)`}
                  unit="Hz"
                  min={displayRangeFor(d, d.measurementType).minHz}
                  max={displayRangeFor(d, d.measurementType).maxHz}
                  onMin={(v) => patch(setDisplayRangePatch(d, d.measurementType, { minHz: v }))}
                  onMax={(v) => patch(setDisplayRangePatch(d, d.measurementType, { maxHz: v }))}
                />
                <RangeField
                  title="Magnitude Range"
                  description="Magnitude range shown in the spectrum chart"
                  unit="dB"
                  min={d.minDb}
                  max={d.maxDb}
                  onMin={(v) => patch({ minDb: v })}
                  onMax={(v) => patch({ maxDb: v })}
                />
                <div className="set-buttons">
                  <button className="btn mini" onClick={saveCurrentView} title="Save the spectrum chart's current zoom as the display range">
                    Save Current View
                  </button>
                  <button className="btn mini" onClick={resetDisplay}>
                    Reset to Defaults
                  </button>
                </div>

                <h4>Analysis Settings</h4>
                {isGuitarType(d.measurementType) && (
                  <label className="set-field check">
                    <input type="checkbox" checked={d.showUnknownModes} onChange={(e) => patch({ showUnknownModes: e.target.checked })} />
                    <span>
                      Show unknown modes
                      <em className="set-inline-desc"> — peaks outside known mode ranges</em>
                    </span>
                  </label>
                )}
                <RangeField
                  title="Analysis Frequency Range"
                  description="Frequency range used for peak detection"
                  unit="Hz"
                  min={d.analysisMinHz}
                  max={d.analysisMaxHz}
                  onMin={(v) => patch({ analysisMinHz: v })}
                  onMax={(v) => patch({ analysisMaxHz: v })}
                />
                <div className="set-range">
                  <div className="set-range-title">Peak Detection Minimum</div>
                  <span className="set-input">
                    <input
                      type="number"
                      value={d.peakMinThreshold}
                      disabled={!isGuitarType(d.measurementType)}
                      onChange={(e) => patch({ peakMinThreshold: Number(e.target.value) })}
                    />
                    <em>dB</em>
                  </span>
                  <p className="set-desc">Minimum magnitude for peak detection. Typical range: −60 to −40 dB</p>
                </div>
                <label className="set-field check">
                  <input type="checkbox" checked={d.dumpCaptureAudio} onChange={(e) => patch({ dumpCaptureAudio: e.target.checked })} />
                  <span>
                    Dump capture audio
                    <em className="set-inline-desc"> — download each captured tap/phase as a 32-bit-float WAV (diagnostic)</em>
                  </span>
                </label>
                <button className="btn mini" onClick={() => resetKeys(ANALYSIS_KEYS)}>
                  Reset analysis settings
                </button>
              </>
            )}
          </section>

          {/* ── About & Help ─────────────────────────────────── */}
          <section>
            <h3>About &amp; Help</h3>
            <div className="set-readout">
              Version <b>{__APP_VERSION__} ({__APP_BUILD__})</b>
            </div>
            <p className="set-note">
              An acoustic analysis tool for guitar makers. Tap-tone analysis using real-time FFT to identify resonant
              frequencies of guitar top and back plates.
            </p>
            <p className="set-note">Copyright © 2026 David W. Smith dba Dolce Sfogato</p>
          </section>
        </div>
      </div>
    </div>
  )
}