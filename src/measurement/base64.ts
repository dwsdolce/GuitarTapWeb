// Compact spectrum encoding for `.guitartap` parity (App. B, "Spectrum data
// encoding"). `frequenciesData` / `magnitudesData` are Base64 strings whose decoded
// bytes are a contiguous little-endian IEEE-754 float32 array (4 bytes per value,
// length = byteCount / 4). All target platforms (x86, ARM, every browser + Node) are
// little-endian, matching Swift's native-order `Data(bytes:)` and Python's `<f` pack.

const CHUNK = 0x8000 // keep String.fromCharCode argument counts well bounded

/** Pack a float array into raw little-endian float32 bytes, Base64-encoded. */
export function floatsToBase64(floats: ArrayLike<number>): string {
  const arr = floats instanceof Float32Array ? floats : Float32Array.from(floats)
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Decode a Base64 string produced by {@link floatsToBase64} back into a number[].
 *  Returns an empty array if the byte length is not a multiple of 4. */
export function base64ToFloats(base64: string): number[] {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  if (bytes.length % 4 !== 0) return []
  // Copy into a fresh, 4-byte-aligned buffer before viewing as Float32Array.
  const aligned = new Uint8Array(bytes) // bytes.buffer offset is 0, but be explicit
  return Array.from(new Float32Array(aligned.buffer, 0, aligned.length / 4))
}