// @parity model/input-level
/**
 * The input level of the latest audio buffer — its RMS level, the recent peak and clipping — owned by
 * the {@link RealtimeFFTAnalyzer} as `level` and updated on every audio buffer, many times a second.
 *
 * It is an object of its own so that only the threshold meter observes it: held as React state in the
 * app, every buffer's level would re-render the whole app. Mirrors Swift `InputLevel`
 * (Models/InputLevel.swift) and Python `InputLevel` (models/input_level.py).
 */
export class InputLevel {
  private _inputLevelDB = -100
  private _isClipping = false
  /** The highest level of the last peak-hold period, in dBFS — the tap's peak for decay tracking.
   *  Swift `recentPeakLevelDB`. Set by the engine; no one observes it. */
  recentPeakLevelDB = -100

  private readonly levelListeners = new Set<(db: number) => void>()
  private readonly clippingListeners = new Set<(clipping: boolean) => void>()

  /** The last chunk's level in dBFS (silence −100), for detection, the meter and decay.
   *  Swift `inputLevelDB`. */
  get inputLevelDB(): number {
    return this._inputLevelDB
  }
  set inputLevelDB(db: number) {
    this._inputLevelDB = db
    for (const l of this.levelListeners) l(db)
  }

  /** True while any chunk in the last clip-hold period reached full scale. Swift `isClipping`;
   *  listeners hear only a change. */
  get isClipping(): boolean {
    return this._isClipping
  }
  set isClipping(clipping: boolean) {
    if (clipping === this._isClipping) return
    this._isClipping = clipping
    for (const l of this.clippingListeners) l(clipping)
  }

  /** Observe the level, on every buffer — Python `inputLevelChanged`. Returns the unsubscribe. */
  onInputLevel(listener: (db: number) => void): () => void {
    this.levelListeners.add(listener)
    return () => this.levelListeners.delete(listener)
  }

  /** Observe clipping, on each change — Python `clippingChanged`. Returns the unsubscribe. */
  onClipping(listener: (clipping: boolean) => void): () => void {
    this.clippingListeners.add(listener)
    return () => this.clippingListeners.delete(listener)
  }
}
