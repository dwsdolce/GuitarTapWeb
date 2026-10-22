/**
 * A diagnostic: how much time the main thread has to spare while audio runs. Off unless the page's URL has
 * `?slackprobe`. Every 5 s it logs one line to the console, in the same form in every edition:
 *
 * - **lag** — a timer asks the main thread for a call every 5 ms; each call's lateness is the time the thread was
 *   busy with something else.
 * - **latency** — from the audio thread posting a chunk to the main thread taking it, on the audio clock.
 * - **busy time** per kind of work: the main thread's per-chunk work (`main/chunk`), the capture filling within it
 *   (`accumulate`), the FFT (`fft`), the work on each FFT frame (`frame`).
 *
 * The web runs all of these on its main thread already, so it has no simulated-FFT switch. Mirrors Swift
 * `SlackProbe` and Python `slack_probe`.
 */

type Kind = 'lag' | 'latency' | 'main/chunk' | 'accumulate' | 'fft' | 'frame'

const INTERVAL_MS = 5
const REPORT_EVERY_MS = 5000

export const slackProbeEnabled: boolean = (() => {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).has('slackprobe')
  } catch {
    return false
  }
})()

const samples = new Map<Kind, number[]>()
let chunkPeriodMs = 0
let started = false

/** Record one duration (ms) of a kind of work. */
export function slackRecord(kind: Kind, ms: number): void {
  if (!slackProbeEnabled) return
  let list = samples.get(kind)
  if (!list) samples.set(kind, (list = []))
  list.push(ms)
}

/** Run `work` and record its duration as `kind`. */
export function slackTime<T>(kind: Kind, work: () => T): T {
  if (!slackProbeEnabled) return work()
  const start = performance.now()
  try {
    return work()
  } finally {
    slackRecord(kind, performance.now() - start)
  }
}

export function slackSetChunkPeriod(count: number, sampleRate: number): void {
  if (slackProbeEnabled && sampleRate > 0) chunkPeriodMs = (count / sampleRate) * 1000
}

function pct(v: number[], p: number): number {
  if (v.length === 0) return 0
  const s = [...v].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]!
}

function report(seconds: number): void {
  const w = new Map(samples)
  samples.clear()
  const f = (x: number) => x.toFixed(2)
  const lag = w.get('lag') ?? []
  const lat = w.get('latency') ?? []
  const parts = [
    `⏱ slack ${seconds.toFixed(1)}s: chunk ${f(chunkPeriodMs)} ms`,
    `lag p50 ${f(pct(lag, 0.5))} p95 ${f(pct(lag, 0.95))} p99 ${f(pct(lag, 0.99))} max ${f(Math.max(0, ...lag))}`,
    `latency p50 ${f(pct(lat, 0.5))} p95 ${f(pct(lat, 0.95))} max ${f(Math.max(0, ...lat))}`,
  ]
  let busy = 0
  for (const kind of ['main/chunk', 'accumulate', 'fft', 'frame'] as Kind[]) {
    const v = w.get(kind) ?? []
    const total = v.reduce((a, b) => a + b, 0)
    if (kind === 'main/chunk' || kind === 'frame') busy += total
    parts.push(`${kind} avg ${f(v.length ? total / v.length : 0)} max ${f(Math.max(0, ...v))} n ${v.length}`)
  }
  parts.push(`main busy ${((busy / (seconds * 1000)) * 100).toFixed(1)}%`)
  console.log(parts.join(' | '))
}

/** Start the lag timer and the 5 s report. Does nothing when the probe is off. */
export function slackStart(): void {
  if (!slackProbeEnabled || started) return
  started = true
  let expected = performance.now() + INTERVAL_MS
  let windowStart = performance.now()
  const tick = () => {
    const now = performance.now()
    slackRecord('lag', Math.max(0, now - expected))
    expected = Math.max(expected + INTERVAL_MS, now)
    if (now - windowStart >= REPORT_EVERY_MS) {
      report((now - windowStart) / 1000)
      windowStart = now
    }
    setTimeout(tick, Math.max(0, expected - performance.now()))
  }
  setTimeout(tick, INTERVAL_MS)
}
