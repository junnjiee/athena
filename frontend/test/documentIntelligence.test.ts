import { describe, expect, test } from 'bun:test'
import { proposalMarkPatch } from '../src/lib/documentIntelligence'
import type { ReserveProposal } from '../src/types/documentIntelligence'

const proposal: ReserveProposal = {
  name: 'Reserve 1', locality: 'Kranji', intelligence_status: 'confirmed',
  source_document_ids: ['a', 'b'],
  claims: [
    { source_document_id: 'a', source_document_name: 'Alpha.pdf', name: 'Reserve 1', locality: 'Kranji', owning_formation: '101 Corps', task_organization: [], evidence: 'first' },
    { source_document_id: 'b', source_document_name: 'Bravo.docx', name: 'Reserve 1', locality: 'Kranji', owning_formation: 'Different owner', task_organization: [], evidence: 'second' },
  ],
}

describe('document reserve acceptance', () => {
  test('populates agreed facts and preserves two-source status', () => {
    const patch = proposalMarkPatch(proposal)
    expect(patch.locality).toBe('Kranji')
    expect(patch.intelligence_status).toBe('confirmed')
    expect(patch.intelligence_evidence).toEqual([
      { source_document_id: 'a', source_document_name: 'Alpha.pdf', excerpt: 'first' },
      { source_document_id: 'b', source_document_name: 'Bravo.docx', excerpt: 'second' },
    ])
  })

  test('does not silently choose one side of a source disagreement', () => {
    expect(proposalMarkPatch(proposal).owning_formation).toBeUndefined()
  })

  test('drops unassessed timing stages the engine reports as null', () => {
    // The engine serialises an unknown stage as null; the server's mark schema
    // accepts only a number or an absent field. Sending null through failed the
    // study submit with "Expected number, received null".
    const patch = proposalMarkPatch({
      ...proposal,
      claims: [{ ...proposal.claims[0]!, timing: { decision_minutes: 30, readiness_minutes: 45, deployment_minutes: null } as never }],
    })
    expect(patch.timing).toEqual({ decision_minutes: 30, readiness_minutes: 45 })
    expect(Object.values(patch.timing!)).not.toContain(null)
  })

  test('timing is absent when every stage is unknown', () => {
    const patch = proposalMarkPatch({
      ...proposal,
      claims: [{ ...proposal.claims[0]!, timing: { decision_minutes: null, readiness_minutes: null, deployment_minutes: null } as never }],
    })
    expect(patch.timing).toBeUndefined()
  })
})
