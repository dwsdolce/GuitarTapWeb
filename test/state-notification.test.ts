// @parity test/notification
//
// One contract, three mechanisms: when the model's readiness changes, the view layer is told.
//
// Web satisfies it by putting the field on the snapshot and calling notify() (this file), Swift
// with @Published (observed via objectWillChange), Python with an explicit signal. Every one of
// those can be broken by an ordinary edit — drop the @Published, forget to add the signal, leave
// the field off the snapshot — and web had the last of those: isReadyForDetection was declared and
// never written, never notified, never on the snapshot, so a device change disabled nothing (#17 F32).
//
// The contract is not "does this framework emit" but "does a state change reach the UI", which all
// three implement and all three can break. PARITY-TEST-METHOD rule 4: an "n/a" that rests on the
// view layer is a finding, not a difference.
//
// Mirrors: GuitarTapTests/StateNotificationTests.swift · tests/test_state_notification.py
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'

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
  // result announcement. Derived, not chosen — see statusAfterSettle(). (#17 F33)
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

  // N7: a COMPLETED measurement survives a device change — the settle blanks only a LIVE spectrum.
  // Swift/Python asked `displayMode == live`, still true of a finished measurement, and wiped it
  // (#17 F35). Web never blanked at all, which was the opposite divergence; it does now.
  it('N7 — a device change leaves a completed measurement intact', () => {
    const a = sut()
    a.isMeasurementComplete = true

    a.handleDeviceChange(true)

    expect(a.isSettling).toBe(false)
  })

  // N8: mid-sequence, with a live spectrum on screen, the settle DOES blank.
  it('N8 — a device change blanks a live spectrum', () => {
    const a = sut()
    a.startTapSequence()

    a.handleDeviceChange(true)
    expect(a.isSettling).toBe(true)

    a.handleDeviceChange(false)
    expect(a.isSettling).toBe(false)
  })

  // N9: a MATERIAL phase prompt is an instruction about something that already happened
  // ("Rotate 90°…"), not a description of the state, so the settle must put it back rather than
  // re-derive it. Two strings are equally correct for one phase — the advance's instruction and a
  // redo's "…— tap again" — which is the proof it is not a function of the state (#17 F37).
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
  // status write while a condition holds must not drop the warning. Web had no dead-input status at
  // all: the engine detected it, warned to the console, retried — and told the user nothing, where
  // both natives showed the warning (#17 F37).
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
  // the consequence synchronously, which is the bug as the user meets it: the warning gets stored AS
  // the real status, so clearing the condition restores the warning forever (#17 F37).
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
  // the same string. They used to be two sets of literals — the advance set 'Rotate 90° and tap for
  // fC' and the derivation repeated it in a second switch — so a drift in either reworded the
  // instruction on every resume, settle and tap-count change (#17 F37). Pinned from both ends: the
  // advance's output, and a pause/resume round trip that re-derives it.
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
})
