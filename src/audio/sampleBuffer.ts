// A growable buffer of 32-bit float samples — the web's form of Swift's `[Float]` session buffer, four bytes
// a sample rather than a JavaScript array's eight. It grows by doubling, so appending a chunk is amortised
// constant time, and it keeps its storage when trimmed or truncated.

export class SampleBuffer {
  private data = new Float32Array(0)
  private count = 0

  /** The number of samples held. */
  get length(): number {
    return this.count
  }

  /** Append a chunk. */
  append(chunk: Float32Array): void {
    const needed = this.count + chunk.length
    if (needed > this.data.length) {
      const grown = new Float32Array(Math.max(needed, this.data.length * 2, 4096))
      grown.set(this.data.subarray(0, this.count))
      this.data = grown
    }
    this.data.set(chunk, this.count)
    this.count = needed
  }

  /** Drop the first `n` samples (Swift `removeFirst(n)`). */
  dropFirst(n: number): void {
    if (n <= 0) return
    if (n >= this.count) {
      this.count = 0
      return
    }
    this.data.copyWithin(0, n, this.count)
    this.count -= n
  }

  /** Keep only the first `n` samples (Swift `removeSubrange(n...)`). */
  truncate(n: number): void {
    if (n < this.count) this.count = Math.max(0, n)
  }

  /** A copy of the samples held. */
  toFloat32Array(): Float32Array {
    return this.data.slice(0, this.count)
  }
}
