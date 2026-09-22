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
})
