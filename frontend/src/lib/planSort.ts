import type { PlanSummary } from '../types/plan'

/** Column the Plans list is ordered by. The server returns newest-updated
 *  first, so 'updated' matches the wire order. */
export type SortKey = 'updated' | 'created' | 'name' | 'ground'

export const SORT_LABELS: Record<SortKey, string> = {
  updated: 'Last edited',
  created: 'Created',
  name: 'Name',
  ground: 'Ground',
}

const newestFirst = (a: string, b: string) => new Date(b).getTime() - new Date(a).getTime()

/** Returns a new array — never sorts the caller's list in place. */
export function sortPlans(plans: readonly PlanSummary[], key: SortKey): PlanSummary[] {
  const copy = [...plans]
  switch (key) {
    case 'created':
      return copy.sort((a, b) => newestFirst(a.createdAt, b.createdAt))
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name))
    case 'ground':
      // Ground groups the list; plans within one battleground stay alphabetical.
      return copy.sort(
        (a, b) =>
          a.battlegroundName.localeCompare(b.battlegroundName) || a.name.localeCompare(b.name),
      )
    default:
      return copy.sort((a, b) => newestFirst(a.updatedAt, b.updatedAt))
  }
}

/** Case-insensitive match against a plan's own name or the ground it sits on. */
export function filterPlans(plans: readonly PlanSummary[], query: string): PlanSummary[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...plans]
  return plans.filter(
    (p) =>
      p.name.toLowerCase().includes(needle) || p.battlegroundName.toLowerCase().includes(needle),
  )
}
