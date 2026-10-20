// @parity util/new-id tests=test/uuid-case
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
/** A UUID in its canonical form — uppercase, as every edition writes it. At run time a string, so it works as
 *  a `Map`/`Set` key, a React key and a JSON value (an object would compare by identity); only
 *  {@link parseUuid} and {@link newId} make one, so the compiler finds any other string used as an id.
 *  The web's form of Swift's `UUID` and Python's `uuid.UUID`. */
export type Uuid = string & { readonly __brand: 'Uuid' }

export const newId = (): Uuid =>
  (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : uuidV4()).toUpperCase() as Uuid

function uuidV4(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40 // version 4
  b[8] = (b[8]! & 0x3f) | 0x80 // RFC 4122 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** The form an id must have, as Swift's `UUID(uuidString:)` takes it: 36 characters, hexadecimal in
 *  groups of 8-4-4-4-12 joined by hyphens, either case (RFC 9562: case-insensitive on input). */
const UUID_FORM = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/

/** A measurement with no spectrum — no guitar spectrum, no plate/brace longitudinal one, or a comparison of
 *  fewer than two entries; a spectrum with no points is none. The entry cannot be read; the rest of its
 *  file can. Mirrors Swift `NoSpectrumError`. */
export class NoSpectrumError extends Error {
  constructor() {
    super('no spectrum')
    this.name = 'NoSpectrumError'
  }
}

/** An id that is not a UUID: the file or record holding it cannot be read. */
export class InvalidIdError extends Error {
  constructor(readonly value: unknown, readonly field: string) {
    super(value == null ? `${field} is missing` : `"${String(value)}" in ${field} is not a UUID`)
    this.name = 'InvalidIdError'
  }
}

/** `value` as a UUID in its canonical form — uppercase, as every edition writes it — or InvalidIdError
 *  naming `field` when it is missing or not a UUID. Mirrors Swift decoding a `UUID`. */
export function parseUuid(value: unknown, field: string): Uuid {
  if (typeof value !== 'string' || !UUID_FORM.test(value)) throw new InvalidIdError(value, field)
  return value.toUpperCase() as Uuid
}

/** The entries of an id-keyed map with their keys as ids (`Object.entries` gives plain strings). */
export const idEntries = <V>(map: Partial<Record<Uuid, V>> | undefined): [Uuid, V][] =>
  Object.entries(map ?? {}) as [Uuid, V][]
