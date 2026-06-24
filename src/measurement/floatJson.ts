// Float32 JSON encoding for `.guitartap` parity (see Documentation/Manual App. B,
// "Number precision"). The Swift writer stores most scalars as `Float` (IEEE-754
// binary32) and its JSONEncoder emits the *shortest decimal that round-trips to that
// float32*, with integral values written without a decimal point (`-100`, not
// `-100.0`). The Python build reproduces this with `str(np.float32(x))`.
//
// In JS a value read back from a float32 blob is a float64 that exactly equals the
// float32, so plain `JSON.stringify` would emit the longer float64-shortest text
// (e.g. 164.157012939453125 instead of 164.15701). `f32()` reproduces Swift's output:
// quantise to float32 via Math.fround, then find the shortest decimal whose float32
// round-trip matches. JSON.stringify of the returned number then emits that same text.
//
// Only fields Swift declares as `Float` go through f32(). Fields Swift declares as
// `Double` — pitchCents, pitchFrequency, sampleRate, colorComponents, the annotation
// absFreqHz/absDB — are already shortest-float64 in both languages and must be left
// untouched.

/** Quantise to float32 and return a number whose JSON form matches Swift's `Float`
 *  encoding. Non-finite values and `null`/`undefined` pass through unchanged. */
export function f32(value: number | null | undefined): number | null | undefined {
  if (value == null) return value
  const f = Math.fround(value)
  if (!Number.isFinite(f)) return f
  // Integral → integer so JSON emits "-100", not "-100.0" (matches Swift).
  if (Number.isInteger(f)) return f
  // Shortest decimal (1–9 significant digits) that round-trips to the same float32.
  for (let p = 1; p <= 9; p++) {
    const s = f.toPrecision(p)
    if (Math.fround(Number(s)) === f) return Number(s)
  }
  return f
}

/** Apply {@link f32} to each element of a list. `null`/`undefined` pass through. */
export function f32List(values: number[] | null | undefined): number[] | null | undefined {
  if (values == null) return values
  return values.map((v) => f32(v) as number)
}