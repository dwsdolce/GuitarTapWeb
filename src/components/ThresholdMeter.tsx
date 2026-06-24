import { useEffect, useRef } from 'react'

// Combined level meter + threshold slider, mirroring the native app's
// ThresholdSlider (Swift Views/Shared/ThresholdSlider.swift ↔ Python
// views/shared/threshold_slider.py): the live RMS level fills the groove on the
// SAME dB scale as a draggable threshold handle, with 10 dB ticks and a decaying
// peak-hold dot. Everything is custom-painted on one canvas and the handle is
// dragged via pointer events — so the handle position and value use the identical
// dbToX mapping (no native <input type=range> thumb-inset / width mismatch).

export interface ThresholdMeterProps {
  /** Live input level (dBFS). */
  level: number
  /** Threshold value (dB) — the handle. */
  value: number
  onChange: (db: number) => void
  min?: number
  max?: number
  /** Rightmost 10% turns red when the input clips. */
  clipping?: boolean
}

// Visual / behaviour constants (mirror the native ThresholdSlider).
const PEAK_HOLD_SECONDS = 0.5
const PEAK_DECAY_DB_PER_SEC = 20
const GROOVE_TOP = 5
const GROOVE_H = 14
const HANDLE_W = 4
const HANDLE_H = 22

export function ThresholdMeter({ level, value, onChange, min = -80, max = -20, clipping = false }: ThresholdMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peak = useRef({ db: min, setTime: 0, last: 0 })
  const dragging = useRef(false)

  // Latest value/range for the pointer handlers without re-binding listeners.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const rangeRef = useRef({ min, max })
  rangeRef.current = { min, max }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const W = Math.max(1, Math.floor(rect.width))
    const H = Math.max(1, Math.floor(rect.height))
    canvas.width = W * dpr
    canvas.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const xFor = (db: number) => Math.max(0, Math.min(1, (db - min) / (max - min))) * W
    const gTop = GROOVE_TOP
    const gMid = gTop + GROOVE_H / 2

    // ── Peak-hold update (snap up, hold, then decay) ──────────────────
    const now = performance.now() / 1000
    const pk = peak.current
    if (now - pk.setTime > PEAK_HOLD_SECONDS) {
      const dt = Math.max(0, now - pk.last)
      pk.db -= PEAK_DECAY_DB_PER_SEC * dt
    }
    if (level > pk.db) {
      pk.db = level
      pk.setTime = now
    }
    if (pk.db < level) pk.db = level
    pk.last = now

    ctx.clearRect(0, 0, W, H)

    // ── Groove background ─────────────────────────────────────────────
    ctx.fillStyle = '#0a0d12'
    ctx.fillRect(0, gTop, W, GROOVE_H)
    ctx.strokeStyle = 'rgba(120,130,140,0.45)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, gTop + 0.5, W - 1, GROOVE_H - 1)

    // ── Level fill (cyan→blue gradient from min to current level) ─────
    const fx = xFor(level)
    if (fx > 0) {
      const grad = ctx.createLinearGradient(0, gTop, 0, gTop + GROOVE_H)
      grad.addColorStop(0, 'rgb(102,204,255)')
      grad.addColorStop(0.7, 'rgb(0,102,204)')
      grad.addColorStop(1, 'rgb(0,30,80)')
      ctx.fillStyle = grad
      ctx.fillRect(1, gTop + 1, Math.max(0, fx - 1), GROOVE_H - 2)
    }

    // ── Clip zone (rightmost 10%) ─────────────────────────────────────
    if (clipping) {
      ctx.fillStyle = 'rgba(220,40,40,0.85)'
      ctx.fillRect(W * 0.9, gTop + 1, W * 0.1, GROOVE_H - 2)
    }

    // ── Tick marks every 10 dB (strictly between bounds, no labels) ───
    for (let db = Math.ceil(min / 10) * 10; db < max; db += 10) {
      if (db <= min) continue
      const x = xFor(db)
      ctx.strokeStyle = 'rgba(61,140,61,0.7)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, gTop + 2)
      ctx.lineTo(x, gTop + GROOVE_H - 2)
      ctx.stroke()
    }

    // ── Peak-hold dot (amber) ─────────────────────────────────────────
    if (pk.db > min) {
      const x = xFor(pk.db)
      ctx.fillStyle = 'rgb(255,200,0)'
      ctx.strokeStyle = 'rgba(255,255,255,0.86)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(x, gMid, 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    // ── Threshold handle (red bar standing proud of the groove) ───────
    const hx = xFor(value)
    ctx.fillStyle = '#ff3b3b'
    ctx.strokeStyle = '#800'
    ctx.lineWidth = 1
    const hy = (H - HANDLE_H) / 2
    ctx.fillRect(hx - HANDLE_W / 2, hy, HANDLE_W, HANDLE_H)
    ctx.strokeRect(hx - HANDLE_W / 2 + 0.5, hy + 0.5, HANDLE_W - 1, HANDLE_H - 1)
  }, [level, value, clipping, min, max])

  // ── Pointer drag (click/drag anywhere jumps the handle) ─────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const apply = (clientX: number) => {
      const rect = canvas.getBoundingClientRect()
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const { min: lo, max: hi } = rangeRef.current
      onChangeRef.current(Math.round(lo + frac * (hi - lo)))
    }
    const onDown = (e: PointerEvent) => {
      dragging.current = true
      canvas.setPointerCapture(e.pointerId)
      apply(e.clientX)
    }
    const onMove = (e: PointerEvent) => {
      if (dragging.current) apply(e.clientX)
    }
    const onUp = (e: PointerEvent) => {
      dragging.current = false
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        /* capture may already be gone */
      }
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    }
  }, [])

  return (
    <div className="thmeter">
      <canvas ref={canvasRef} className="thmeter-canvas" />
      <span className="thmeter-val">{value} dB</span>
    </div>
  )
}
