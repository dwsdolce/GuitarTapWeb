// @parity view/settings
import { useRef, useState, type ChangeEvent, type ReactNode, type SelectHTMLAttributes } from 'react'
import { NumberField } from './NumberField'
import { FieldPrecision } from '../precision'
import { formattedAsWholeHertz } from '../presentation/frequencyFormat'
import type { StoredCalibration } from '../measurement/calibrationStore'
import { MaterialDimensions, type Dimensions } from '../dsp/material'
import { modeBands } from '../dsp/guitarModes'
import {
  ANALYSIS_KEYS,
  DEFAULT_SETTINGS,
  DISPLAY_KEYS,
  MEASUREMENT_DESCRIPTION,
  MEASUREMENT_FULL_NAME,
  MEASUREMENT_TYPES,
  STIFFNESS_LABEL,
  defaultMinFrequency,
  defaultMaxFrequency,
  minFrequency,
  maxFrequency,
  setMinFrequency,
  setMaxFrequency,
  setFrequencyRange,
  validateFrequencyRange,
  validateMagnitudeRange,
  setMagnitudeRange,
  isGuitarType,
  type MeasurementType,
  type Settings,
  type StiffnessPreset,
} from '../settings'
import type { ChartView } from '../presentation/chartTypes'
import { enteredValue } from '../presentation/displayRange'
import { APPEARANCES, APPEARANCE_LABEL, type Appearance } from '../presentation/appearance'
import { AlertModal } from './AlertModal'
import { MicrophoneIcon, GuitarsIcon, MaterialLayersIcon, CogsIcon, ChartLineIcon, PulseIcon, InfoIcon, FilePlusIcon, TrashIcon, SaveIcon, UndoIcon, HelpIcon, BookIcon, ChevronUpIcon, ChevronDownIcon, ChevronRightIcon, OpenInNewIcon, UnfoldMoreIcon } from './icons'

/**
 * Props for {@link SettingsPanel}. Display/analysis/measurement edits are buffered and
 * applied on Done; the audio-input & calibration controls apply immediately.
 */
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
  /** The versioned online User Manual URL (opened in a new tab). */
  userManualUrl: string
  /** Open the in-app Quick Start Guide (closes Settings first). */
  onShowQuickStart: () => void
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

/** The short mode names of Settings' Mode Frequency Ranges, as Swift's. */
const MODE_RANGE_LABEL: Record<string, string> = { air: 'Air', top: 'Top', back: 'Back', dipole: 'Dipole', ring: 'Ring' }

const STIFFNESS_PRESETS: StiffnessPreset[] = [
  'steelStringTop',
  'steelStringBack',
  'classicalTop',
  'classicalBack',
  'custom',
]

/** Restricts a number input to `decimals` fractional digits — the mirror of Swift `limitedInput` /
 * Python `_decimal_validator`. A keystroke that would exceed the precision is reverted, so the
 * over-precise digit never appears; an accepted value is rounded to P and pushed to state. */
function restrictNumberInput(
  e: ChangeEvent<HTMLInputElement>,
  value: number,
  decimals: number,
  set: (v: number) => void,
) {
  const s = e.target.value
  if (!FieldPrecision.decimalsWithin(s, decimals)) {
    e.target.value = String(value) // reject: revert the over-precise character
    return
  }
  if (s === '' || s === '-') return // in-progress entry; don't push 0
  set(FieldPrecision.rounded(Number(s), decimals))
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
  decimals,
}: {
  title: string
  description: string
  unit: string
  min: number
  max: number
  onMin: (v: number) => void
  onMax: (v: number) => void
  decimals: number
}) {
  return (
    <div className="set-range">
      {/* The title and its fields on one row, the fields right-aligned — Swift's "min to max unit". */}
      <div className="ts-row">
        <span>{title}</span>
        <div className="set-range-inputs">
          <span className="set-input">
            <input type="text" inputMode="decimal" aria-label={`${title} minimum`} value={FieldPrecision.string(min, decimals)} onChange={(e) => restrictNumberInput(e, min, decimals, onMin)} />
          </span>
          <span className="set-range-dash">to</span>
          <span className="set-input">
            <input type="text" inputMode="decimal" aria-label={`${title} maximum`} value={FieldPrecision.string(max, decimals)} onChange={(e) => restrictNumberInput(e, max, decimals, onMax)} />
            <em>{unit}</em>
          </span>
      </div>
      </div>
      <p className="set-desc">{description}</p>
    </div>
  )
}

/** A Settings section — Swift's grouped Form section: an icon and a bold title, its rows in a grey
 *  box with no lines between them, and an optional note under the box. */
function SetSection({ icon, title, note, children }: { icon: ReactNode; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="ts-sec">
      <div className="ts-title">
        <span className="ts-icon">{icon}</span>
        {title}
      </div>
      <div className="ts-box">{children}</div>
      {note && <p className="ts-note">{note}</p>}
    </section>
  )
}

/** A group inside a section — a bold title, without an icon, over its own box. */
function SetGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ts-sec ts-group">
      <div className="ts-title">{title}</div>
      <div className="ts-box">{children}</div>
    </section>
  )
}

/** A setting that is on or off: its label and description on the left, the checkbox right-aligned —
 *  as every other control (Swift's checkbox toggle, Python's). */
function SetToggle({ label, description, checked, onChange, disabled = false }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="ts-toggle">
      <span className="ts-toggle-text">
        <span>{label}</span>
        {description && <span className="ts-toggle-desc">{description}</span>}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

/** A label on the left, its value or control on the right. */
/** A menu picker drawn as Swift's: a filled rounded box with the value and a ⌃⌄ at its right. The menu is the
 *  browser's own. */
function MenuPicker(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="menu-picker">
      <select {...props} />
      <UnfoldMoreIcon />
    </span>
  )
}

function SetRow({ label, children, secondary = false }: { label: string; children: ReactNode; secondary?: boolean }) {
  return (
    <div className="ts-row">
      <span className={secondary ? 'ts-secondary' : undefined}>{label}</span>
      {children}
    </div>
  )
}

/**
 * The Tap Settings dialog — mirrors Swift `TapSettingsView`. Sections: Audio Input &
 * Calibration (applies immediately), Measurement Type (guitar mode ranges / plate + Gore /
 * brace dimensions), a collapsible Advanced group (Display + Analysis settings), and
 * About & Help. Edits are buffered in a draft and committed on Done, discarded on Cancel.
 */
export function SettingsPanel({
  settings,
  sampleRate,
  deviceLabel,
  currentView,
  onApply,
  onSaveCurrentView,
  onClose,
  userManualUrl,
  onShowQuickStart,
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
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
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
    const type = d.measurementType
    patch({ ...p, ...setFrequencyRange(d, { minHz: defaultMinFrequency(type), maxHz: defaultMaxFrequency(type) }, type) })
  }

  // Save Current View persists immediately (Swift behavior) AND reflects into the draft
  // so Done doesn't revert it and the range fields update.
  const saveCurrentView = () => {
    onSaveCurrentView()
    patch({
      ...setFrequencyRange(d, {
        minHz: currentView.minHz,
        maxHz: currentView.maxHz,
      }, d.measurementType),
      ...setMagnitudeRange(currentView.minDb, currentView.maxDb),
    })
  }

  // Done validates the display ranges as Swift's applySettings does: out of bounds or too narrow falls
  // back to the saved range.
  // A field left showing the saved value keeps that value exactly (enteredValue), as the natives do.
  const done = () => {
    const t = d.measurementType
    const field = (draft: number, saved: number, decimals: number) =>
      enteredValue(FieldPrecision.string(draft, decimals), saved, decimals) ?? saved
    const freq = validateFrequencyRange(
      settings,
      field(minFrequency(d, t), minFrequency(settings, t), FieldPrecision.frequencyHz),
      field(maxFrequency(d, t), maxFrequency(settings, t), FieldPrecision.frequencyHz),
      t,
    )
    const db = validateMagnitudeRange(
      settings,
      field(d.minDb, settings.minDb, FieldPrecision.magnitudeDB),
      field(d.maxDb, settings.maxDb, FieldPrecision.magnitudeDB),
    )
    onApply({ ...d, ...setFrequencyRange(d, freq, t), ...setMagnitudeRange(db.minDb, db.maxDb) })
    onClose()
  }

  const isGuitar = isGuitarType(d.measurementType)
  const activeCalibration = calibrations.find((c) => c.id === activeCalibrationId) ?? null
  const guitarBands = isGuitarType(d.measurementType) ? modeBands(d.measurementType) : []
  const density = (dims: Dimensions) => (
    <SetRow label="Calculated Density" secondary>
      <b className="ts-value">{FieldPrecision.string(new MaterialDimensions(dims).densityGPerCm3, FieldPrecision.densityGPerCm3)} g/cm³</b>
    </SetRow>
  )

  return (
    <div className="settings-overlay" role="dialog" aria-label="Settings" onClick={onClose}>
      <div className="settings-modal tap-settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-head">
          <h2>Tap Settings</h2>
          {/* On a phone Cancel / Done sit at the top, as an iPhone's navigation bar; elsewhere at the
              bottom, as a macOS sheet's. */}
          <div className="set-head-buttons phone-only">
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
          <SetSection
            icon={<MicrophoneIcon />}
            title="Audio Input & Calibration"
            note="Audio input and calibration changes take effect immediately and are not affected by Cancel. Calibrations are automatically associated with each device."
          >
            <SetRow label="Audio Input Device">
              <MenuPicker
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
              </MenuPicker>
            </SetRow>
            <SetRow label="Sample Rate">
              <span className="ts-value">{sampleRate ? formattedAsWholeHertz(sampleRate) : '—'}</span>
            </SetRow>
            <SetRow label="Calibration">
              <MenuPicker
                value={activeCalibrationId ?? ''}
                onChange={(e) => onSelectCalibration(e.target.value || null)}
              >
                <option value="">None (Uncalibrated)</option>
                {calibrations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </MenuPicker>
            </SetRow>
            {activeCalibration && (
              <div className="ts-cal-details">
                <span>
                  {activeCalibration.sensitivityFactor != null && <>Sensitivity: {activeCalibration.sensitivityFactor.toFixed(2)} dB<br /></>}
                  Data points: {activeCalibration.points.length}
                </span>
                {activeCalibration.points.length > 0 && (
                  <span>
                    {activeCalibration.points[0]!.frequency.toFixed(0)}-{activeCalibration.points[activeCalibration.points.length - 1]!.frequency.toFixed(0)} Hz
                  </span>
                )}
              </div>
            )}
            <div className="ts-actions">
              <button className="btn mini tint tint-accent" onClick={() => calFileInput.current?.click()}>
                <FilePlusIcon />
                <span>Import Calibration File…</span>
              </button>
              {calibrations.length > 0 && (
                <button className="btn mini tint tint-accent" onClick={() => setConfirmDeleteAll(true)}>
                  <TrashIcon />
                  <span>Delete All Calibrations</span>
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
          </SetSection>
          {confirmDeleteAll && (
            <AlertModal
              title="Delete All Calibrations?"
              message={`This will permanently delete all ${calibrations.length} saved calibrations. This cannot be undone.`}
              buttons={[
                {
                  label: 'Delete All',
                  primary: true,
                  onClick: () => {
                    for (const c of calibrations) onDeleteCalibration(c.id)
                    setConfirmDeleteAll(false)
                  },
                },
                { label: 'Cancel', onClick: () => setConfirmDeleteAll(false) },
              ]}
              onDismiss={() => setConfirmDeleteAll(false)}
            />
          )}

          {/* ── Measurement Type, then one titled box per group of its settings ── */}
          <SetSection
            icon={isGuitar ? <GuitarsIcon /> : <MaterialLayersIcon />}
            title="Measurement Type"
            note={
              isGuitar
                ? 'Select your guitar type for accurate mode classification.'
                : 'Enter the dimensions and mass of your rectangular wood sample. The app will calculate stiffness, speed of sound, and radiation ratio from the tap frequencies.'
            }
          >
            <SetRow label="Measurement Type">
              <MenuPicker
                value={d.measurementType}
                onChange={(e) => patch({ measurementType: e.target.value as MeasurementType })}
              >
                {MEASUREMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MEASUREMENT_FULL_NAME[t]}
                  </option>
                ))}
              </MenuPicker>
            </SetRow>
            <p className="set-desc">{MEASUREMENT_DESCRIPTION[d.measurementType]}</p>
          </SetSection>

          {isGuitarType(d.measurementType) && (
            <SetGroup title="Mode Frequency Ranges">
              {/* Swift's two columns: Air / Top / Back, then Dipole / Ring. */}
              <div className="ts-mode-ranges">
                {[['air', 'top', 'back'], ['dipole', 'ring']].map((col) => (
                  <div key={col[0]} className="ts-mode-col">
                    {col.map((name) => {
                      const b = guitarBands.find((band) => band.name === name)
                      return b ? (
                        <div key={name} className="ts-mode-row">
                          <span className="ts-secondary">{MODE_RANGE_LABEL[name]}:</span>
                          <span>
                            {b.lo}-{b.hi} Hz
                          </span>
                        </div>
                      ) : null
                    })}
                  </div>
                ))}
              </div>
            </SetGroup>
          )}

          {d.measurementType === 'plate' && (
            <>
              <SetGroup title="Sample Dimensions">
                <NumberField label="Length (along grain)" unit="mm" value={d.plateLength} decimals={FieldPrecision.linearDimensionMM} onChange={(v) => patch({ plateLength: v })} />
                <NumberField label="Width (cross grain)" unit="mm" value={d.plateWidth} decimals={FieldPrecision.linearDimensionMM} onChange={(v) => patch({ plateWidth: v })} />
                <NumberField label="Thickness" unit="mm" value={d.plateThickness} decimals={FieldPrecision.linearDimensionMM} onChange={(v) => patch({ plateThickness: v })} />
                <NumberField label="Mass" unit="g" value={d.plateMass} decimals={FieldPrecision.massG} onChange={(v) => patch({ plateMass: v })} />
                {density(plateDims)}
                <SetToggle
                  label="Measure Diagonal (fLC) Tap"
                  description="Add a 3rd tap: hold plate at midpoint of one long edge, tap near opposite corner. Measures shear stiffness for Gore target thickness."
                  checked={d.measureFlc}
                  onChange={(v) => patch({ measureFlc: v })}
                />
              </SetGroup>
              <SetGroup title="Gore Target Thickness — Body Dimensions">
                <p className="set-desc">
                  Finished guitar body dimensions used in Gore's Eq. 4.5-7 to calculate target plate thickness.
                </p>
                <NumberField label="Body Length (a)" unit="mm" value={d.guitarBodyLength} decimals={FieldPrecision.bodyDimensionMM} onChange={(v) => patch({ guitarBodyLength: v })} />
                <NumberField label="Lower Bout Width (b)" unit="mm" value={d.guitarBodyWidth} decimals={FieldPrecision.bodyDimensionMM} onChange={(v) => patch({ guitarBodyWidth: v })} />
              </SetGroup>
              <SetGroup title="Plate Vibrational Stiffness (f_vs)">
                <SetRow label="Panel Type">
                  <MenuPicker
                    value={d.plateStiffnessPreset}
                    onChange={(e) => patch({ plateStiffnessPreset: e.target.value as StiffnessPreset })}
                  >
                    {STIFFNESS_PRESETS.map((p) => (
                      <option key={p} value={p}>
                        {STIFFNESS_LABEL[p]}
                      </option>
                    ))}
                  </MenuPicker>
                </SetRow>
                {d.plateStiffnessPreset === 'custom' && (
                  <NumberField label="Custom f_vs value" unit="" value={d.customPlateStiffness} decimals={FieldPrecision.stiffness} onChange={(v) => patch({ customPlateStiffness: v })} />
                )}
              </SetGroup>
            </>
          )}

          {d.measurementType === 'brace' && (
            <SetGroup title="Brace Dimensions">
              <NumberField label="Length (along grain)" unit="mm" value={d.braceLength} decimals={FieldPrecision.linearDimensionMM} onChange={(v) => patch({ braceLength: v })} />
              <NumberField label="Width (breadth)" unit="mm" value={d.braceWidth} decimals={FieldPrecision.linearDimensionMM} onChange={(v) => patch({ braceWidth: v })} />
              <NumberField label="Height (tap direction)" unit="mm" value={d.braceThickness} decimals={FieldPrecision.linearDimensionMM} onChange={(v) => patch({ braceThickness: v })} />
              <p className="set-desc">Brace height when lying flat — this is the t dimension in the stiffness formula</p>
              <NumberField label="Mass" unit="g" value={d.braceMass} decimals={FieldPrecision.massG} onChange={(v) => patch({ braceMass: v })} />
              {density(braceDims)}
            </SetGroup>
          )}

          {/* ── Advanced (collapsible): Display and Analysis settings ── */}
          {/* Swift's disclosure row: the label, then the chevron at the right edge (down closed, up open). */}
          <section className="ts-sec">
            <div className="ts-box">
              <button className="ts-disclosure" onClick={() => setShowAdvanced((v) => !v)} aria-expanded={showAdvanced}>
                <span className="ts-icon">
                  <CogsIcon />
                </span>
                <span>Advanced</span>
                <span className="ts-chevron">{showAdvanced ? <ChevronUpIcon /> : <ChevronDownIcon />}</span>
              </button>
            </div>
          </section>

          {showAdvanced && (
            <>
              <SetSection icon={<ChartLineIcon />} title="Display Settings">
                <SetRow label="Appearance">
                  <MenuPicker
                    value={d.appearance}
                    onChange={(e) => patch({ appearance: e.target.value as Appearance })}
                  >
                    {APPEARANCES.map((a) => (
                      <option key={a} value={a}>
                        {APPEARANCE_LABEL[a]}
                      </option>
                    ))}
                  </MenuPicker>
                </SetRow>
                <p className="set-desc">System follows the operating system&apos;s Light or Dark setting</p>
                <RangeField
                  title="Frequency Range"
                  description="Frequency range shown in the spectrum chart"
                  unit="Hz"
                  min={minFrequency(d, d.measurementType)}
                  max={maxFrequency(d, d.measurementType)}
                  onMin={(v) => patch(setMinFrequency(d, v, d.measurementType))}
                  onMax={(v) => patch(setMaxFrequency(d, v, d.measurementType))}
                  decimals={FieldPrecision.frequencyHz}
                />
                <RangeField
                  title="Magnitude Range"
                  description="Magnitude range shown in the spectrum chart"
                  unit="dB"
                  min={d.minDb}
                  max={d.maxDb}
                  onMin={(v) => patch({ minDb: v })}
                  onMax={(v) => patch({ maxDb: v })}
                  decimals={FieldPrecision.magnitudeDB}
                />
                <div className="ts-actions">
                  <button className="btn mini tint tint-accent" onClick={saveCurrentView} title="Save the spectrum chart's current zoom as the display range">
                    <SaveIcon />
                    <span>Save Current View</span>
                  </button>
                  <button className="btn mini tint tint-accent" onClick={resetDisplay}>
                    <UndoIcon />
                    <span>Reset to Defaults</span>
                  </button>
                </div>
              </SetSection>

              <SetSection icon={<PulseIcon />} title="Analysis Settings">
                {isGuitar && (
                  <SetToggle
                    label="Show Unknown Modes"
                    description="Display peaks that don't fall within known mode ranges"
                    checked={d.showUnknownModes}
                    onChange={(v) => patch({ showUnknownModes: v })}
                  />
                )}
                {/* The analysis frequency range is a fixed 30–2000 Hz constant, not a user setting — it
                    bounds the useful modal region and never needs changing (see ANALYSIS_MIN_HZ /
                    ANALYSIS_MAX_HZ). The control was removed; detection still restricts to the range. */}
                <div className={`set-range${isGuitar ? '' : ' disabled'}`}>
                  <div className="ts-row">
                    <span>Peak Detection Minimum</span>
                    <span className="set-input">
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label="Peak Detection Minimum"
                        value={d.peakMinThreshold}
                        disabled={!isGuitar}
                        onChange={(e) => restrictNumberInput(e, d.peakMinThreshold, FieldPrecision.magnitudeDB, (v) => patch({ peakMinThreshold: v }))}
                      />
                      <em>dB</em>
                    </span>
                  </div>
                  <p className="set-desc">Minimum magnitude for peak detection. Typical range: −60 to −40 dB</p>
                </div>
                {/* One WAV per measurement, not per tap/phase (session recording). The browser hides the
                    Downloads path from the page and offers no way to open a folder, so naming Downloads is
                    the most the web can truthfully show — no path field or Open button (unlike the native apps). */}
                <SetToggle
                  label="Dump Capture Audio"
                  description="Download each measurement's captured audio as a 32-bit-float WAV, to your browser's Downloads folder"
                  checked={d.dumpCaptureAudio}
                  onChange={(v) => patch({ dumpCaptureAudio: v })}
                />
                <div className="ts-actions">
                  <button className="btn mini tint tint-accent" onClick={() => resetKeys(ANALYSIS_KEYS)}>
                    <UndoIcon />
                    <span>Reset Analysis Settings</span>
                  </button>
                </div>
              </SetSection>
            </>
          )}

          {/* ── About & Help ─────────────────────────────────── */}
          <SetSection icon={<InfoIcon />} title="About & Help">
            <SetRow label="Version">
              <span className="ts-secondary">
                {__APP_VERSION__} ({__APP_BUILD__})
              </span>
            </SetRow>
            <p className="set-desc">Copyright © 2026 David W. Smith dba Dolce Sfogato</p>
            <button className="ts-link" onClick={onShowQuickStart}>
              <HelpIcon />
              <span>Quick Start Guide</span>
              <span className="ts-chevron ts-trailing">
                <ChevronRightIcon />
              </span>
            </button>
            <button className="ts-link" onClick={() => window.open(userManualUrl, '_blank', 'noopener,noreferrer')}>
              <BookIcon />
              <span>User Manual</span>
              <span className="ts-chevron ts-trailing">
                <OpenInNewIcon />
              </span>
            </button>
          </SetSection>
        </div>

        <div className="settings-modal-foot not-phone">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={done}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
