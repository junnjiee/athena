import type { Mark } from '../db/studyTypes'

export interface SourceDocument {
  id: string
  name: string
  text: string
}

export interface ReserveClaim {
  source_document_id: string
  name: string
  locality: string
  level?: Mark['level'] | null
  owning_formation?: string | null
  task_organization: NonNullable<Mark['task_organization']>
  timing?: Mark['timing'] | null
  evidence: string
}

export interface ReserveProposal {
  name: string
  locality: string
  intelligence_status: NonNullable<Mark['intelligence_status']>
  source_document_ids: string[]
  claims: ReserveClaim[]
}

export interface DocumentIntelligence {
  proposals: ReserveProposal[]
  rejected: { source_document_id: string; name: string; reason: string }[]
}
