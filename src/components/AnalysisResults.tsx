// Live guitar-summary bar — Ring-Out + Tap Ratio, side by side with a divider, pinned below the
// scrollable peak list and above the export bar. A measured value is shown bold with its coloured quality
// and a second line (the −dB threshold / the ideal range); with no value only a small grey placeholder
// shows ("Waiting…" / "Need Air & Top"), with no second line. Mirrors Swift guitarAnalysisSummary
// (TapAnalysisResultsView) and Python's inline guitar-summary. Reuses the shared analysisQuality helpers
// so the labels/colors agree with the PDF.
// @parity view/guitar-summary

import {
  decayQuality,
  decayQualityColor,
  tapToneRatioQuality,
  tapToneRatioQualityColor,
} from '../dsp/analysisQuality'
import type { GuitarTypeName } from '../dsp/guitarModes'
import { FieldPrecision } from '../precision'

function Column({
  caption,
  value,
  placeholder,
  quality,
  qualityColor,
  sub,
}: {
  caption: string
  /** The measured value, or null — then only `placeholder` shows, small and grey, with no `sub`. */
  value: string | null
  placeholder: string
  quality: string
  qualityColor: string
  sub: string
}) {
  return (
    <div className="analysis-col">
      <div className="ac-cap">{caption}</div>
      {value == null ? (
        <div className="ac-placeholder">{placeholder}</div>
      ) : (
        <>
          <div className="ac-val-row">
            <span className="ac-val">{value}</span>
            {quality && (
              <span className="ac-qual" style={{ color: qualityColor }}>
                {quality}
              </span>
            )}
          </div>
          <div className="ac-sub">{sub}</div>
        </>
      )}
    </div>
  )
}

/**
 * The live guitar-summary bar — Ring-Out + Tap Ratio side by side. Mirrors Swift
 * `guitarAnalysisSummary` (TapAnalysisResultsView) / Python's inline guitar-summary. Always
 * visible; shows the "Waiting…" / "Need Air & Top" placeholders until measured, then the value +
 * colored quality label (via the shared {@link decayQuality}/{@link tapToneRatioQuality} helpers).
 */
export function AnalysisResults({
  decayTime,
  decayThreshold,
  ratio,
  guitarType,
}: {
  /** Ring-out time (s), or null until measured. */
  decayTime: number | null
  /** The dB drop that defines the ring-out (the analyzer's `decayThreshold`). */
  decayThreshold: number
  /** Tap-tone ratio f_Top / f_Air, or null when an Air or Top peak is missing. */
  ratio: number | null
  guitarType: GuitarTypeName
}) {
  return (
    <div className="analysis-bar">
      <Column
        caption="Ring-Out"
        value={decayTime != null ? `${FieldPrecision.string(decayTime, FieldPrecision.decayTimeS)}s` : null}
        placeholder="Waiting…"
        quality={decayTime != null ? decayQuality(decayTime, guitarType) : ''}
        qualityColor={decayTime != null ? decayQualityColor(decayTime, guitarType) : ''}
        sub={`–${Math.trunc(decayThreshold)} dB`}
      />
      <div className="analysis-divider" />
      <Column
        caption="Tap Ratio"
        value={ratio != null ? `${FieldPrecision.string(ratio, FieldPrecision.decayRatio)}:1` : null}
        placeholder="Need Air & Top"
        quality={ratio != null ? tapToneRatioQuality(ratio) : ''}
        qualityColor={ratio != null ? tapToneRatioQualityColor(ratio) : ''}
        sub="Ideal: 1.9–2.1"
      />
    </div>
  )
}