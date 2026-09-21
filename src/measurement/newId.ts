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
 */
export const newId = (): string => crypto.randomUUID().toUpperCase()
