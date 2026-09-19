import type { IntelligenceStatus, ReserveTiming, TaskOrganizationElement } from './routeStudy'

export interface ReserveClaim {
  source_document_id: string
  source_document_name?: string
  name: string
  locality: string
  owning_formation?: string | null
  task_organization: TaskOrganizationElement[]
  timing?: ReserveTiming | null
  evidence: string
}

export interface ReserveProposal {
  name: string
  locality: string
  intelligence_status: IntelligenceStatus
  source_document_ids: string[]
  claims: ReserveClaim[]
}

export interface DocumentIntelligence {
  proposals: ReserveProposal[]
  rejected: { source_document_id: string; name: string; reason: string }[]
}
