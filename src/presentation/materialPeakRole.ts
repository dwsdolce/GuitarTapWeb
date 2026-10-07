// @parity view/material-peak-role
// The role an identified plate or brace peak plays — its name, colour and badge wherever a peak is
// shown by its role: the results panel's fL / fC / fLC badges and Measurement Details.
// Mirrors Swift MaterialPeakRole.
import type { Role } from './palette'

export type MaterialPeakRole = 'longitudinal' | 'cross' | 'flc'

export const MATERIAL_PEAK_ROLE_NAME: Record<MaterialPeakRole, string> = {
  longitudinal: 'Longitudinal',
  cross: 'Cross-grain',
  flc: 'Diagonal',
}

export const MATERIAL_PEAK_ROLE_COLOR: Record<MaterialPeakRole, Role> = {
  longitudinal: 'material.longitudinal',
  cross: 'material.cross',
  flc: 'material.flc',
}

/** The badge's text — the frequency the role measures. */
export const MATERIAL_PEAK_ROLE_BADGE: Record<MaterialPeakRole, string> = {
  longitudinal: 'fL',
  cross: 'fC',
  flc: 'fLC',
}
