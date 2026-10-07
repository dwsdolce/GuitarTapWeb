import { MATERIAL_PEAK_ROLE_BADGE, MATERIAL_PEAK_ROLE_COLOR, type MaterialPeakRole } from '../presentation/materialPeakRole'
import { cssVariable } from '../presentation/palette'

/** A role's badge: filled in its colour with white text when active, grey otherwise. Mirrors Swift
 *  MaterialPhaseBadge. fLC is wider for its third letter. */
export function MaterialPhaseBadge({ role, active = true }: { role: MaterialPeakRole; active?: boolean }) {
  return (
    <span
      className={`mat-badge${role === 'flc' ? ' wide' : ''}`}
      style={active ? { background: `var(${cssVariable(MATERIAL_PEAK_ROLE_COLOR[role])})`, color: 'var(--c-text-on-color)' } : undefined}
    >
      {MATERIAL_PEAK_ROLE_BADGE[role]}
    </span>
  )
}
