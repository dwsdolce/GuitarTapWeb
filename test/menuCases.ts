// @parity none — the web tests' reader for the shared menu case files; Swift's and Python's have their own in their
// menu tests.
/** A shared menu case file (saved-measurement-menu.json, export-menus.json) as this edition shows it. */

/** One item of a shared menu case file. */
export interface MenuCase {
  action: string
  titles: Record<string, string>
  mdi: string | null
}

/** A shared menu case file's groups as this edition shows them: the items with a 'web' title, no group left
 *  empty. */
export function expectedGroups(groups: MenuCase[][]): { action: string; title: string; mdi: string | null }[][] {
  return groups
    .map((g) => g.filter((c) => c.titles.web !== undefined).map((c) => ({ action: c.action, title: c.titles.web!, mdi: c.mdi })))
    .filter((g) => g.length > 0)
}
