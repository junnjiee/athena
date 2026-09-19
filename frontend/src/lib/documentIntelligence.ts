import type { ReserveClaim, ReserveProposal } from '../types/documentIntelligence'
import type { ReserveTiming, StudyMark } from '../types/routeStudy'

function consensus<T>(claims: ReserveClaim[], read: (claim: ReserveClaim) => T | null | undefined): T | undefined {
  const values = claims.map(read).filter((value): value is T => value != null)
  if (values.length === 0) return undefined
  const encoded = new Set(values.map((value) => JSON.stringify(value)))
  return encoded.size === 1 ? values[0] : undefined
}

/** The engine reports an unassessed stage as null; a mark records it by
 *  leaving the field out, which is also all the server accepts. */
function assessedTiming(timing: ReserveTiming | null | undefined): ReserveTiming | undefined {
  if (!timing) return undefined
  const stages = Object.entries(timing).filter(([, minutes]) => minutes != null)
  return stages.length > 0 ? Object.fromEntries(stages) : undefined
}

/** Populate only facts on which the cited claims agree. Disagreements remain
 * visible in the proposal instead of one source silently winning. */
export function proposalMarkPatch(proposal: ReserveProposal): Partial<StudyMark> {
  const taskOrganization = consensus(proposal.claims, (claim) => claim.task_organization)
  return {
    locality: proposal.locality,
    intelligence_status: proposal.intelligence_status,
    intelligence_evidence: proposal.claims.map((claim) => ({
      source_document_id: claim.source_document_id,
      source_document_name: claim.source_document_name ?? claim.source_document_id,
      excerpt: claim.evidence,
    })),
    owning_formation: consensus(proposal.claims, (claim) => claim.owning_formation),
    timing: consensus(proposal.claims, (claim) => assessedTiming(claim.timing)),
    task_organization: taskOrganization?.map((element) => ({
      ...element,
      id: crypto.randomUUID(),
      platforms: element.platforms.map((platform) => ({ ...platform, id: crypto.randomUUID() })),
    })),
  }
}
