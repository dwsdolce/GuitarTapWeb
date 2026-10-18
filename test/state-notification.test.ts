// @parity test/notification
//
// A device change and the settle after it, against the shared cases in notification.json (N1–N18), the
// same as Swift and Python: detection stands down and New Tap greys out — and the view is told, which the
// web does by putting the field on the snapshot and calling notify(), Swift with @Published and Python
// with a signal, each of which an ordinary edit can break — a live chart is blanked, and once 3 s of
// audio have passed since the last change and the next frame has arrived, the latch is re-anchored,
// readiness and listening come back and the status is put back.
//
// Mirrors: GuitarTapTests/StateNotificationTests.swift · tests/test_state_notification.py
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { makeStepsAnalyzer, runAnalyzerStep, PHASE_RAW, type AnalyzerStep } from './analyzerSteps'

type Fields = Record<string, unknown>
type Step = AnalyzerStep & {
  note?: boolean
  watchNotifications?: boolean
  clipping?: boolean
  inputDead?: boolean
  check?: Fields
}
type Case = { id: string; note: string; steps: Step[]; expect: Fields }
const DATA = JSON.parse(readFileSync('test/fixtures/notification.json', 'utf8')) as { cases: Case[] }

type Internals = { isAboveThreshold: boolean; statusBeforeSettle: string | null }

/** What a case's run keeps between steps. */
type Run = { notedStatus: string | null; notedPeaks: string[]; readinessNotified: boolean; watching: boolean }

function check(fields: Fields, a: TapToneAnalyzer, run: Run, id: string): void {
  const internal = a as unknown as Internals
  for (const [field, want] of Object.entries(fields)) {
    const msg = `${id} ${field}`
    switch (field) {
      case 'ready': expect(a.getSnapshot().isReadyForDetection, msg).toBe(want); break
      case 'readinessNotified': expect(run.readinessNotified, msg).toBe(want); break
      case 'settling': expect(a.isSettling, msg).toBe(want); break
      case 'statusMessage': expect(a.statusMessage, msg).toBe(want); break
      case 'statusAsNoted': expect(a.statusMessage === run.notedStatus, `${msg}: ${a.statusMessage} vs ${run.notedStatus}`).toBe(want); break
      case 'statusBeforeSettleAsNoted':
        expect(internal.statusBeforeSettle === run.notedStatus, `${msg}: ${internal.statusBeforeSettle}`).toBe(want)
        break
      case 'statusIsArmedPrompt': expect(a.statusMessage === a.armedPrompt(), msg).toBe(want); break
      case 'detecting': expect(a.isDetecting, msg).toBe(want); break
      case 'paused': expect(a.isDetectionPaused, msg).toBe(want); break
      case 'complete': expect(a.isMeasurementComplete, msg).toBe(want); break
      case 'phase': expect(PHASE_RAW[a.materialTapPhase], msg).toBe(want); break
      case 'aboveThreshold': expect(internal.isAboveThreshold, msg).toBe(want); break
      case 'hasPeaks': expect(a.peaks.length > 0, `${msg}: ${a.peaks.length}`).toBe(want); break
      case 'peaksAsNoted': expect(JSON.stringify(a.peaks.map((p) => p.id)) === JSON.stringify(run.notedPeaks), msg).toBe(want); break
      default: throw new Error(`${id}: unknown field ${field}`)
    }
  }
}

describe('notification — the shared cases (notification.json)', () => {
  for (const c of DATA.cases) {
    it(c.id, () => {
      const a = makeStepsAnalyzer()
      const run: Run = { notedStatus: null, notedPeaks: [], readinessNotified: false, watching: false }
      let readyBefore = a.getSnapshot().isReadyForDetection
      // The view's subscription: it is told of each change and reads the snapshot.
      const unsubscribe = a.subscribe(() => {
        const ready = a.getSnapshot().isReadyForDetection
        if (run.watching && ready !== readyBefore) run.readinessNotified = true
        readyBefore = ready
      })
      for (const step of c.steps) {
        if (step.note) {
          run.notedStatus = a.statusMessage
          run.notedPeaks = a.peaks.map((p) => p.id)
        } else if (step.watchNotifications) {
          run.watching = true
          readyBefore = a.getSnapshot().isReadyForDetection
        } else if (step.clipping !== undefined) a.setClipping(step.clipping)
        else if (step.inputDead !== undefined) a.setInputAppearsDead(step.inputDead)
        else if (step.check) check(step.check, a, run, c.id)
        else expect(runAnalyzerStep(step, a), `${c.id}: unknown step ${JSON.stringify(step)}`).toBe(true)
      }
      check(c.expect, a, run, c.id)
      unsubscribe()
    })
  }
})
