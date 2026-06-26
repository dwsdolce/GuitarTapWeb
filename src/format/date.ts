// Single source of truth for user-facing date/time display (see
// DATE-TIME-FORMAT-CONSISTENCY.md). Locale-aware, in the user's local time:
// medium date + short time, e.g. en-US "Jun 25, 2026, 2:34 PM"; de-DE "25.06.2026, 14:34".
// NOTE: this is DISPLAY only. The .guitartap `timestamp` stays ISO-8601 UTC, and export
// filenames keep their `<slug>-<unix>` form — neither goes through here.

/** Medium date + short time, locale-aware (local timezone). For lists, detail, PDF, etc. */
export function formatDisplayDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Compact variant (no year) for tight spots like chart titles / comparison legends:
 *  e.g. en-US "Jun 25, 2:34 PM"; de-DE "25.06., 14:34". */
export function formatDisplayDateCompact(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}