// @parity test/notification
//
// One contract, three mechanisms: when the model's readiness changes, the view layer is told.
//
// Web satisfies it by putting the field on the snapshot and calling notify() (this file), Swift
// with @Published (observed via objectWillChange), Python with an explicit signal. Every one of
// those can be broken by an ordinary edit — drop the @Published, forget to add the signal, leave
// the field off the snapshot — so each edition pins it.
//
// The contract is not "does this framework emit" but "does a state change reach the UI", which all
// three implement and all three can break.
//
// Mirrors: GuitarTapTests/StateNotificationTests.swift · tests/test_state_notification.py
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { makeResonantPeak } from '../src/measurement/types'

const sut = () => new TapToneAnalyzer()

describe('StateNotification', () => {
  // N1: standing readiness down notifies subscribers and is visible on the snapshot.
  it('N1 — readiness cleared notifies observers', () => {
    const a = sut()
    let fired = 0
    const unsubscribe = a.subscribe(() => { fired += 1 })

    a.handleDeviceChange(true)

    expect(a.getSnapshot().isReadyForDetection).toBe(false)
    expect(fired).toBeGreaterThan(0)
    unsubscribe()
  })

  // N2: restoring readiness notifies too — the button has to come back, not just go away.
  it('N2 — readiness restored notifies observers', () => {
    const a = sut()
    a.handleDeviceChange(true)
    let fired = 0
    const unsubscribe = a.subscribe(() => { fired += 1 })

    a.handleDeviceChange(false)

    expect(a.getSnapshot().isReadyForDetection).toBe(true)
    expect(fired).toBeGreaterThan(0)
    unsubscribe()
  })

  // N3: the production path — the settling edge of a device change stands readiness down and says so.
  it('N3 — a device change clears readiness and notifies', () => {
    const a = sut()
    let fired = 0
    const unsubscribe = a.subscribe(() => { fired += 1 })

    a.handleDeviceChange(true)

    expect(a.isReadyForDetection).toBe(false)
    expect(fired).toBeGreaterThan(0)
    unsubscribe()
  })

  // N4: the settle must not tell a FINISHED measurement to tap again, and must not throw away a
  // result announcement. Derived, not chosen — see statusAfterSettle().
  it('N4 — a complete measurement keeps its status through a device change', () => {
    const a = sut()
    a.numberOfTaps = 1
    a.currentTapCount = 1
    a.isMeasurementComplete = true
    const announced = 'Analysis complete! 12 peaks identified (from 1 averaged taps).'
    expect(a.statusAfterSettle()).toBeNull()
    expect(a.restoredStatus(announced)).toBe(announced)

    // End to end, both edges: the transient must not survive the settle.
    a.handleDeviceChange(true)
    expect(a.statusMessage).toMatch(/reinitializing/)
    a.handleDeviceChange(false)
    expect(a.statusMessage).not.toMatch(/reinitializing/)
    expect(a.statusMessage).not.toMatch(/Tap again/)
  })

  // N5: mid-sequence, the settle reports what was captured — not "tap N times", which is what the
  // old two-branch guess said once a tap was already in hand.
  it('N5 — mid-sequence the settle reports progress, not the opening instruction', () => {
    const a = sut()
    a.numberOfTaps = 3
    a.startTapSequence()
    a.currentTapCount = 1
    expect(a.statusAfterSettle()).toBe('Tap 1/3 captured. Tap again...')
  })

  // N6: idle and nothing captured — "Ready".
  it('N6 — idle settles to Ready', () => {
    const a = sut()
    expect(a.statusAfterSettle()).toBe('Ready')
  })

  // N7: a COMPLETED measurement survives a device change — the settle blanks only a LIVE spectrum,
  // and `displayMode == live` alone would still be true of a finished measurement.
  it('N7 — a device change leaves a completed measurement intact', () => {
    const a = sut()
    a.peaks = [makeResonantPeak({ frequency: 100, magnitude: -40, quality: 0, bandwidth: 0 })]
    a.isMeasurementComplete = true

    a.handleDeviceChange(true)

    expect(a.isSettling).toBe(false) // a completed measurement is not a live spectrum — nothing to blank
    expect(a.peaks).toHaveLength(1) // REGRESSION: the settle wiped a finished measurement's peaks
  })

  // N8: mid-sequence, with a live spectrum on screen, the settle DOES blank.
  it('N8 — a device change blanks a live spectrum', () => {
    const a = sut()
    a.startTapSequence()
    a.peaks = [makeResonantPeak({ frequency: 100, magnitude: -40, quality: 0, bandwidth: 0 })] // a live frame's peaks

    a.handleDeviceChange(true)
    expect(a.isSettling).toBe(true)
    expect(a.peaks).toHaveLength(0) // and its peaks cleared, so no annotation floats on a blank chart

    a.handleDeviceChange(false)
    expect(a.isSettling).toBe(false)
  })

  // N9: a MATERIAL phase prompt is an instruction about something that already happened
  // ("Rotate 90°…"), not a description of the state, so the settle must put it back rather than
  // re-derive it. Two strings are equally correct for one phase — the advance's instruction and a
  // redo's "…— tap again" — which is the proof it is not a function of the state.
  it('N9 — the settle preserves a material phase instruction', () => {
    const a = sut()
    a.measurementType = 'plate'
    a.materialTapPhase = 'capturingC'
    a.startTapSequence({ arm: false })
    a.materialTapPhase = 'capturingC' // startTapSequence resets the phase; this is mid-sequence
    const afterRedo = 'Ready for fC tap — tap again'

    expect(a.statusAfterSettle()).toBeNull()
    expect(a.restoredStatus(afterRedo)).toBe(afterRedo)
  })

  // N10: the override precedence, in one place. Dead input outranks clipping, and an ordinary
  // status write while a condition holds must not drop the warning.
  it('N10 — dead input outranks clipping and survives a status write', () => {
    const a = sut()
    a.startTapSequence({ arm: false })
    a.setNumberOfTaps(1)
    expect(a.statusMessage).toBe('Tap the guitar...')

    a.setClipping(true)
    expect(a.statusMessage).toMatch(/clipping/)

    a.setInputAppearsDead(true)
    expect(a.statusMessage).toMatch(/No audio input/)

    a.setNumberOfTaps(3) // an ordinary status write must not drop the warning
    expect(a.statusMessage).toMatch(/No audio input/)

    a.setInputAppearsDead(false)
    expect(a.statusMessage).toMatch(/clipping/)
    a.setClipping(false)
    expect(a.statusMessage).toBe('Tap the guitar 3 times...')
  })

  // N11: what the settle PRESERVES is the analyzer's real status, not the override-resolved string.
  // The natives assert the captured value (their restore is behind a 3 s timer); web can also reach
  // the consequence synchronously, as the user would meet it: were the warning stored AS the real
  // status, clearing the condition would restore the warning forever.
  it('N11 — the settle captures the real status, not an override warning', () => {
    const a = sut()
    a.startTapSequence({ arm: false })
    a.setNumberOfTaps(3)
    a.setClipping(true)
    expect(a.statusMessage).toMatch(/clipping/)

    a.handleDeviceChange(true)
    expect((a as unknown as { statusBeforeSettle: string | null }).statusBeforeSettle)
      .toBe('Tap the guitar 3 times...')

    a.handleDeviceChange(false)
    a.setClipping(false)
    expect(a.statusMessage).toBe('Tap the guitar 3 times...')
  })

  // N12: the phase ADVANCE and the armed DERIVATION must produce the same string, because they are
  // the same string — otherwise a resume, settle or tap-count change would reword the instruction.
  // Pinned from both ends: the advance's output, and a pause/resume round trip that re-derives it.
  it('N12 — the material phase advance and the armed derivation agree', () => {
    const a = sut()
    a.measurementType = 'plate'
    a.setMeasureFlc(false)
    a.materialTapPhase = 'reviewingL'

    a.acceptMaterial()

    expect(a.materialTapPhase).toBe('capturingC') // precondition: the accept advanced the phase
    expect(a.statusMessage).toBe('Rotate 90° and tap for fC')

    a.detectionState = 'listening' // no device in a unit test, so arming is a no-op
    a.pauseTapDetection()
    a.resumeTapDetection()
    expect(a.statusMessage).toBe('Rotate 90° and tap for fC')
  })

  // N13: a settling edge DURING a settle must not capture the transient as the pre-settle status.
  // The burst is what a user does — unplug and replug faster than the settle — and an unguarded
  // capture stores 'Audio device changed - reinitializing...' AS the real status. Every state whose
  // status is not re-derivable (N4's completed measurement, N9's material phase instruction) then
  // has the transient put back on top of itself, where it stays until the next tap writes over it.
  // Found in the #24 run-review on Windows in brace mode, where both natives had it; web is guarded
  // on both halves — `statusBeforeSettle === null` here and `clearTimeout` in useAudioEngine — and
  // this pins the half that lives in the model.
  it('N13 — a settling edge during a settle does not capture the transient', () => {
    const a = sut()
    a.measurementType = 'brace'
    a.setNumberOfTaps(1)
    a.startTapSequence({ arm: false })   // the production path to the material arm prompt
    a.detectionState = 'listening'
    expect(a.statusMessage).toBe('Ready for fL tap')   // precondition

    a.handleDeviceChange(true)   // unplug
    a.handleDeviceChange(true)   // replug, inside the settle

    expect(a.statusMessage).toBe('Audio device changed - reinitializing...')
    expect((a as unknown as { statusBeforeSettle: string | null }).statusBeforeSettle)
      .toBe('Ready for fL tap')

    a.handleDeviceChange(false)

    expect(a.statusMessage).toBe('Ready for fL tap')
  })
})
