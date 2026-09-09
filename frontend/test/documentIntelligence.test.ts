import { describe, expect, test } from 'bun:test'
import { proposalMarkPatch } from '../src/lib/documentIntelligence'
import type { ReserveProposal } from '../src/types/documentIntelligence'

const proposal: ReserveProposal = {
  name: 'Reserve 1', locality: 'Kranji', intelligence_status: 'confirmed',
  source_document_ids: ['a', 'b'],
  claims: [
    { source_document_id: 'a', name: 'Reserve 1', locality: 'Kranji', level: 'K2', owning_formation: '101 Corps', task_organization: [], evidence: 'first' },
    { source_document_id: 'b', name: 'Reserve 1', locality: 'Kranji', level: 'K2', owning_formation: 'Different owner', task_organization: [], evidence: 'second' },
  ],
}

describe('document reserve acceptance', () => {
  test('populates agreed facts and preserves two-source status', () => {
    const patch = proposalMarkPatch(proposal)
    expect(patch.locality).toBe('Kranji')
    expect(patch.intelligence_status).toBe('confirmed')
    expect(patch.level).toBe('K2')
  })

  test('does not silently choose one side of a source disagreement', () => {
    expect(proposalMarkPatch(proposal).owning_formation).toBeUndefined()
  })
})
