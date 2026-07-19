// Single source of truth for user-facing date/time display. Locale-aware, in the user's
// local time: medium date + short time, e.g. en-US "Jun 25, 2026, 2:34 PM"; de-DE "25.06.2026, 14:34".
// NOTE: this is DISPLAY only. The .guitartap `timestamp` stays ISO-8601 UTC, and export
// filenames keep their `<slug>-<unix>` form — neither goes through here.

/** Medium date + short time, locale-aware (local timezone). For lists, detail, PDF, etc.
 *  Formats date and time in SEPARATE calls joined with ", " — modern ICU applies the CLDR `atTime`
 *  glue ("… at …") whenever ONE formatter combines a date and a time (both `dateStyle`+`timeStyle`
 *  AND field-based combos), so the only way to guarantee the comma form is to never combine them in
 *  one call. Result: en-US "Jul 16, 2026, 3:56 PM", matching Python (Babel standard combine) + Swift. */
export function formatDisplayDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${date}, ${time}`
}

/** Compact variant (no year) for tight spots like chart titles / comparison legends:
 *  e.g. en-US "Jun 25, 2:34 PM"; de-DE "25.06., 14:34".
 *
 *  Same rule as formatDisplayDate above: format date and time in SEPARATE calls joined with ", "
 *  so modern ICU never applies the `atTime` glue ("… at …") that a single toLocaleString combining
 *  date + time would. Matches Python's compact combine. */
export function formatDisplayDateCompact(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${date}, ${time}`
}