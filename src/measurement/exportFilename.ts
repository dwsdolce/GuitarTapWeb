// Single source of truth for exported-artifact filenames.
// See FILE-PATHS-AND-NAMES-SPEC.md §2b. Mirrors Swift `ExportFilename.stem` /
// Python `export_filename.export_stem`.
//
// @parity model/export-filename

/**
 * The filename stem shared by every exported artifact — `.guitartap`, PDF, spectrum PNG.
 *
 *     stem = <measurement name, slugged  OR  the artifact's own default word> - <unix seconds>
 *
 * - The name is slugged exactly as the native apps do: spaces and `/` become `-`, then lowercased.
 *   (Nothing else — Unicode letters are preserved, matching Swift/Python; the old web PNG/PDF paths
 *   used a `[^\w.-]` regex that ASCII-mangled names like "Ramírez".)
 * - `epochSeconds` is a discriminator, not part of the name — two measurements may share a name —
 *   and is always integer seconds.
 * - `unnamed` is the per-artifact default word, used only when there is no name: `"measurement"`
 *   for `.guitartap`, `"report"` for PDF, `"spectrum"` for PNG. A default **name**, never an infix.
 */
export function exportStem(name: string | null | undefined, epochSeconds: number, unnamed: string): string {
  const slug = (name ?? '').replace(/[ /]/g, '-').toLowerCase()
  return `${slug || unnamed}-${epochSeconds}`
}