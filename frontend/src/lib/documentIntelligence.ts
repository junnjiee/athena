import type { ReserveClaim, ReserveProposal } from '../types/documentIntelligence'
import type { StudyMark } from '../types/routeStudy'

function consensus<T>(claims: ReserveClaim[], read: (claim: ReserveClaim) => T | null | undefined): T | undefined {
  const values = claims.map(read).filter((value): value is T => value != null)
  if (values.length === 0) return undefined
  const encoded = new Set(values.map((value) => JSON.stringify(value)))
  return encoded.size === 1 ? values[0] : undefined
}

/** Populate only facts on which the cited claims agree. Disagreements remain
 * visible in the proposal instead of one source silently winning. */
export function proposalMarkPatch(proposal: ReserveProposal): Partial<StudyMark> {
  const taskOrganization = consensus(proposal.claims, (claim) => claim.task_organization)
  return {
    locality: proposal.locality,
    intelligence_status: proposal.intelligence_status,
    level: consensus(proposal.claims, (claim) => claim.level),
    owning_formation: consensus(proposal.claims, (claim) => claim.owning_formation),
    timing: consensus(proposal.claims, (claim) => claim.timing),
    task_organization: taskOrganization?.map((element) => ({
      ...element,
      id: crypto.randomUUID(),
      platforms: element.platforms.map((platform) => ({ ...platform, id: crypto.randomUUID() })),
    })),
  }
}
