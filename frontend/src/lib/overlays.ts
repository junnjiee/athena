import { ASSESSED_HEX, HOSTILE_HEX } from './colors'
import type { AggressorEchelon, StudyMark } from '../types/routeStudy'

/** The S2 overlay the map is currently standing in for. Colour is
 *  overlay-scoped (DOCTRINE.md §3): the same hue means different things on
 *  each, so the overlay is an explicit input rather than something inferred. */
export type S2Overlay = 'deployment' | 'conduct'

/** Conduct of Battle colours encode the reserve's echelon. Doctrine names
 *  three; anything else falls back to the hostile default rather than being
 *  given an invented hue. Battalion pink is deliberately not the deployment
 *  overlay's assessed pink. */
export const CONDUCT_ECHELON_HEX: Partial<Record<AggressorEchelon, string>> = {
  company: '#f0913f',
  battalion: '#f06fb8',
  regiment: '#9c6b3f',
}

const ECHELON_RANK: Record<AggressorEchelon, number> = {
  division: 5,
  regiment: 4,
  battalion: 3,
  company: 2,
  platoon: 1,
  section: 0,
}

/** The largest formation in the reserve's task organisation, or null when
 *  no composition has been recorded. */
export function reserveEchelon(mark: StudyMark): AggressorEchelon | null {
  const elements = mark.task_organization ?? []
  if (elements.length === 0) return null
  return elements.reduce((largest, element) =>
    ECHELON_RANK[element.echelon] > ECHELON_RANK[largest] ? element.echelon : largest,
  elements[0].echelon)
}

export function reserveMarkColor(mark: StudyMark, overlay: S2Overlay): string {
  if (overlay === 'deployment') {
    return mark.intelligence_status === 'confirmed' ? HOSTILE_HEX : ASSESSED_HEX
  }
  const echelon = reserveEchelon(mark)
  return (echelon && CONDUCT_ECHELON_HEX[echelon]) || HOSTILE_HEX
}
