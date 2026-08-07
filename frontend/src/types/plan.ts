import type { BattlegroundMeta, GridData, OsmFeatures } from './terrain'
import type { PlacedObjective, PlacedRoute, PlacedUnit } from './entities'

/** Lightweight row for the Plans list page -- no terrain/units payload. */
export interface PlanSummary {
  id: string
  name: string
  battlegroundName: string
  createdAt: string
  updatedAt: string
}

/** Full plan + terrain snapshot as returned by GET /api/plans/:id. */
export interface SavedPlan {
  plan: {
    id: string
    name: string
    units: PlacedUnit[]
    objectives: PlacedObjective[]
    routes: PlacedRoute[]
    /** mission start, epoch ms; null when the operator never set one */
    hHour: number | null
  }
  meta: BattlegroundMeta
  features: OsmFeatures
  grid: GridData
}
