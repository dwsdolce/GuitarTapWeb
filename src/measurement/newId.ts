/**
 * Single source of truth for minting UUID strings.
 *
 * **Uppercase**, because Swift's `UUID().uuidString` is uppercase and every id that can travel
 * between editions has to compare equal as a string. Python mints through the same kind of helper
 * (`utilities/new_uuid.py`) for the same reason.
 *
 * Case has never affected correctness *within* one store — a file's internal references agree with
 * its own ids whatever their case — so existing records stay valid and are not rewritten. It
 * matters the moment two editions compare ids for the same thing, which is what `id` on a
 * measurement and on a calibration are for.
 *
 * Everything that mints goes through here, including `rowKey`, which is library-local and would not
 * strictly need it: one rule with no exceptions is cheaper to keep true than one rule and a list of
 * places it does not apply. `test/uuid-case` pins that nothing calls `crypto.randomUUID()` directly.
 *
 * `crypto.randomUUID` exists only in a secure context (HTTPS or localhost); a page served over plain
 * HTTP — the preview opened from a phone on the local network — builds the same version-4 UUID from
 * `crypto.getRandomValues`, which every context has.
 */
export const newId = (): string =>
  (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : uuidV4()).toUpperCase()

function uuidV4(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40 // version 4
  b[8] = (b[8]! & 0x3f) | 0x80 // RFC 4122 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
