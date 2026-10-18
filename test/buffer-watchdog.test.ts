// @parity test/buffer-watchdog
//
// The buffer watchdog's tick and recovery, against the shared cases in buffer-watchdog.json (BW1–BW14), the
// same as Swift and Python: the start-up grace, the guards, a recovery for no buffers or for buffers with no
// signal, the backoff between restarts, giving up while still watching, a restart that observes no signal, a
// failed restart retrying, and a healthy tick clearing it all. The engine runs on a wall clock moved by hand,
// with a stand-in for the recovery's restart; the tick runs at each whole second, as the 1 s timer does.
//
// Mirrors: GuitarTapTests/BufferWatchdogTests.swift · tests/test_buffer_watchdog.py
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import { ManualWallClock } from './audioClockFeed'

type Fields = Record<string, unknown>
type Step = {
  start?: boolean
  run?: number
  input?: 'signal' | 'silence' | 'none'
  restart?: 'succeeds' | 'fails'
  permissionDenied?: boolean
  playFile?: boolean
  stop?: boolean
  check?: Fields
}
type Case = { id: string; note: string; steps: Step[]; expect: Fields }
const DATA = JSON.parse(readFileSync('test/fixtures/buffer-watchdog.json', 'utf8')) as { cases: Case[] }

/** Exact in binary, so every time the cases reach is exact in every edition. */
const STEP = 0.5

/** The engine's watchdog state the cases read and the runner sets, as the natives' tests reach theirs. */
type Internals = {
  context: { state: string } | null
  lastChunkTime: number
  lastSignalTime: number
  recoveryAttempts: number
  isRecovering: boolean
  watchdogRecoveryExhausted: boolean
  setMicrophonePermissionDenied(denied: boolean): void
}

/** Let the recovery's awaited restart finish. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('buffer-watchdog — the shared cases (buffer-watchdog.json)', () => {
  // The 1 s timer must not tick on its own: the runner ticks at each whole second of the wall clock.
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))
  afterEach(() => vi.useRealTimers())

  for (const c of DATA.cases) {
    it(c.id, async () => {
      const clock = new ManualWallClock()
      const engine = new RealtimeFFTAnalyzer()
      const internal = engine as unknown as Internals
      engine.wallClock = clock
      let restartFails = false
      const restartTimes: number[] = []
      // The stand-in for re-acquiring the input; the recovery re-arms the watchdog itself after it.
      engine.watchdogRestart = async () => {
        restartTimes.push(clock.now())
        if (restartFails) throw new Error('the stand-in restart failed')
      }

      const check = (fields: Fields) => {
        for (const [field, want] of Object.entries(fields)) {
          const msg = `${c.id} ${field}`
          switch (field) {
            case 'attempts': expect(internal.recoveryAttempts, msg).toBe(want); break
            case 'recovering': expect(internal.isRecovering, msg).toBe(want); break
            case 'givenUp': expect(internal.watchdogRecoveryExhausted, msg).toBe(want); break
            case 'inputDead': expect(engine.inputAppearsDead, msg).toBe(want); break
            case 'couldNotRestart': expect(engine.inputCouldNotRestart, msg).toBe(want); break
            case 'permissionDenied': expect(engine.microphonePermissionDenied, msg).toBe(want); break
            case 'restarts': expect(restartTimes.length, msg).toBe(want); break
            case 'restartTimes': expect(restartTimes, msg).toEqual(want); break
            default: throw new Error(`${c.id}: unknown field ${field}`)
          }
        }
      }

      for (const step of c.steps) {
        if (step.start) {
          internal.context = { state: 'running' }
          engine.startBufferWatchdog()
        } else if (step.run !== undefined) {
          for (let i = 0; i < Math.round(step.run / STEP); i++) {
            clock.advance(STEP)
            await settle()
            if (step.input !== 'none') internal.lastChunkTime = clock.now() * 1000
            if (step.input === 'signal') internal.lastSignalTime = clock.now() * 1000
            if (clock.now() % 1 === 0) engine.checkBufferWatchdog()
          }
        } else if (step.restart) restartFails = step.restart === 'fails'
        else if (step.permissionDenied) internal.setMicrophonePermissionDenied(true)
        else if (step.playFile) engine.playingFile = true
        else if (step.stop) internal.context = null
        else if (step.check) check(step.check)
        else throw new Error(`${c.id}: unknown step ${JSON.stringify(step)}`)
      }
      check(c.expect)
    })
  }
})
