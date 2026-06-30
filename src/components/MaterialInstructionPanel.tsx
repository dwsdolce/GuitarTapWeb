// Below-graph instruction panel for material (plate/brace) measurements. Mirrors Swift
// `materialInstructionsView` (TapToneAnalysisView+SpectrumViews.swift) and Python
// `_build_material_instr_panel` / `_update_plate_phase_ui`: a card showing the current
// phase (colored dot + short status + "Phase N/M"), an icon, a bold title, and a detailed
// instruction body. All strings are replicated verbatim from the canonical Swift source.

import type { MatPhase } from '../hooks/useMaterialSession'

// Apple system colors used by SwiftUI .gray/.blue/.orange/.purple/.green.
const PHASE_COLOR: Record<MatPhase, string> = {
  notStarted: '#8e8e93',
  capturingL: '#007aff',
  reviewingL: '#007aff',
  capturingC: '#ff9500',
  reviewingC: '#ff9500',
  capturingFlc: '#af52de',
  reviewingFlc: '#af52de',
  complete: '#34c759',
}

// Mirrors Swift MaterialTapPhase.shortStatus.
const SHORT_STATUS: Record<MatPhase, string> = {
  notStarted: 'Ready',
  capturingL: 'L tap...',
  reviewingL: 'Review L',
  capturingC: 'C tap...',
  reviewingC: 'Review C',
  capturingFlc: 'FLC tap...',
  reviewingFlc: 'Review FLC',
  complete: 'Done',
}

type IconKind = 'handTap' | 'waveform' | 'check' | 'checkFill'

// Mirrors Swift materialPhaseIcon (SF Symbols hand.tap / waveform / checkmark.circle[.fill]).
const PHASE_ICON: Record<MatPhase, IconKind> = {
  notStarted: 'handTap',
  capturingL: 'waveform',
  reviewingL: 'check',
  capturingC: 'waveform',
  reviewingC: 'check',
  capturingFlc: 'waveform',
  reviewingFlc: 'check',
  complete: 'checkFill',
}

function PhaseIcon({ kind, color }: { kind: IconKind; color: string }) {
  const common = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (kind) {
    case 'handTap':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M8 11V5a2 2 0 0 1 4 0v6" />
          <path d="M12 11V4a2 2 0 0 1 4 0v7" />
          <path d="M16 11V6a2 2 0 0 1 4 0v8a6 6 0 0 1-6 6h-2a6 6 0 0 1-5.2-3l-2.3-4a2 2 0 0 1 3.4-2L8 11" />
        </svg>
      )
    case 'waveform':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M3 12h2l2-7 4 18 3-13 2 5h5" />
        </svg>
      )
    case 'check':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 12.5l2.5 2.5 4.5-5" />
        </svg>
      )
    case 'checkFill':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill={color} aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12.5l2.5 2.5 5.5-6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
  }
}

function phaseStep(phase: MatPhase, brace: boolean, measureFlc: boolean): number {
  switch (phase) {
    case 'notStarted':
    case 'capturingL':
    case 'reviewingL':
      return 1
    case 'capturingC':
    case 'reviewingC':
      return 2
    case 'capturingFlc':
    case 'reviewingFlc':
      return 3
    case 'complete':
      return brace ? 1 : measureFlc ? 3 : 2
  }
}

function phaseTitle(phase: MatPhase, brace: boolean): string {
  switch (phase) {
    case 'notStarted':
      return 'Press ‘New Tap’ to Begin'
    case 'capturingL':
      return brace ? 'Step 1: Longitudinal (fL) Mode' : 'Step 1: Longitudinal (L) Mode'
    case 'reviewingL':
      return 'Review L Tap — Accept or Redo'
    case 'capturingC':
      return 'Step 2: Cross-grain (C) Mode'
    case 'reviewingC':
      return 'Review C Tap — Accept or Redo'
    case 'capturingFlc':
      return 'Step 3: FLC (Diagonal) Mode'
    case 'reviewingFlc':
      return 'Review FLC Tap — Accept or Redo'
    case 'complete':
      return 'Measurement Complete'
  }
}

function phaseDescription(phase: MatPhase, brace: boolean, measureFlc: boolean): string {
  switch (phase) {
    case 'notStarted':
      if (brace) return 'Press ‘New Tap’ to begin the brace fL measurement.'
      return `Press ‘New Tap’ to begin the ${measureFlc ? 'three-tap' : 'two-tap'} plate measurement process.`
    case 'capturingL':
      return brace
        ? 'Hold brace at 22% from one end along the length. Tap center.'
        : 'Hold plate at 22% from one end along the length, near one long edge (not at the width node). Tap center.'
    case 'reviewingL':
      return 'L tap captured. Review the spectrum — press Accept to continue to the C tap, or Redo to re-capture.'
    case 'capturingC':
      return 'Hold plate at 22% from one end along the width, near one short edge (not at the length node). Tap center.'
    case 'reviewingC':
      return 'C tap captured. Review the spectrum — press Accept to continue, or Redo to re-capture.'
    case 'capturingFlc':
      return 'Hold plate at the midpoint of one long edge. Tap near the opposite corner (~22% from both the end and the side). Measures shear stiffness.'
    case 'reviewingFlc':
      return 'FLC tap captured. Review the spectrum — press Accept to complete the measurement, or Redo to re-capture.'
    case 'complete':
      if (brace)
        return 'fL captured! Review the fL (blue) peak selection in the Results panel. Adjust if the auto-selection isn’t correct.'
      return `All modes captured! Review the L (blue), C (orange)${measureFlc ? ', and FLC (purple)' : ''} peak selections in the Results panel. Adjust if the auto-selection isn’t correct.`
  }
}

export function MaterialInstructionPanel({
  phase,
  brace,
  measureFlc,
}: {
  phase: MatPhase
  brace: boolean
  measureFlc: boolean
}) {
  const color = PHASE_COLOR[phase]
  const totalPhases = measureFlc ? 3 : 2
  return (
    <section className="mat-instr" aria-label={brace ? 'Brace Measurement' : 'Plate Measurement'}>
      <div className="mat-instr-head">{brace ? 'Brace Measurement' : 'Plate Measurement'}</div>
      <div className="mat-instr-phase">
        <span className="mat-instr-dot" style={{ background: color }} />
        <span className="mat-instr-short" style={{ color }}>
          {SHORT_STATUS[phase]}
        </span>
        {!brace && (
          <span className="mat-instr-step">
            Phase {phaseStep(phase, brace, measureFlc)}/{totalPhases}
          </span>
        )}
      </div>
      <div className="mat-instr-divider" />
      <div className="mat-instr-body">
        <span className="mat-instr-icon" style={{ color }}>
          <PhaseIcon kind={PHASE_ICON[phase]} color={color} />
        </span>
        <div className="mat-instr-text">
          <div className="mat-instr-title">{phaseTitle(phase, brace)}</div>
          <div className="mat-instr-desc">{phaseDescription(phase, brace, measureFlc)}</div>
        </div>
      </div>
    </section>
  )
}