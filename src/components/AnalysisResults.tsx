// Live guitar-summary bar — Ring-Out + Tap Ratio, side by side with a divider, pinned below the
// scrollable peak list and above the export bar. Matches the native live panel exactly (Python
// tap_tone_analysis_view guitar-summary / Swift TapAnalysisResultsView): always visible, with
// "Waiting…" / "Need Air & Top" empty states and the value + colored quality inline. Reuses the
// shared analysisQuality helpers so the labels/colors agree with the PDF.
// @parity view/analysis-metrics

import {
  decayQuality,
  decayQualityColor,
  tapToneRatioQuality,
  tapToneRatioQualityColor,
} from '../dsp/analysisQuality'
import type { GuitarTypeName } from '../dsp/guitarModes'

function Column({
  caption,
  value,
  quality,
  qualityColor,
  sub,
}: {
  caption: string
  value: string
  quality: string
  qualityColor: string
  sub: string
}) {
  return (
    <div className="analysis-col">
      <div className="ac-cap">{caption}</div>
      <div className="ac-val-row">
        <span className="ac-val">{value}</span>
        {quality && (
          <span className="ac-qual" style={{ color: qualityColor }}>
            {quality}
          </span>
        )}
      </div>
      <div className="ac-sub">{sub}</div>
    </div>
  )
}

export function AnalysisResults({
  decayTime,
  ratio,
  guitarType,
}: {
  /** Ring-out time (s), or null until measured. */
  decayTime: number | null
  /** Tap-tone ratio f_Top / f_Air, or null when an Air or Top peak is missing. */
  ratio: number | null
  guitarType: GuitarTypeName
}) {
  return (
    <div className="analysis-bar">
      <Column
        caption="Ring-Out"
        value={decayTime != null ? `${decayTime.toFixed(2)}s` : 'Waiting…'}
        quality={decayTime != null ? decayQuality(decayTime, guitarType) : ''}
        qualityColor={decayTime != null ? decayQualityColor(decayTime, guitarType) : ''}
        sub="–15 dB"
      />
      <div className="analysis-divider" />
      <Column
        caption="Tap Ratio"
        value={ratio != null ? `${ratio.toFixed(2)}:1` : 'Need Air & Top'}
        quality={ratio != null ? tapToneRatioQuality(ratio) : ''}
        qualityColor={ratio != null ? tapToneRatioQualityColor(ratio) : ''}
        sub="Ideal: 1.9–2.1"
      />
    </div>
  )
}