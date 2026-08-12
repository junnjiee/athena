import type { BattlegroundMeta, GridData, OsmFeatures } from './terrain'

/** Wire contract for the engine's ReplayLog, schema_version 3 (engine/athena/models/replay.py).
 *  Deliberately snake_case, mirroring the engine's JSON verbatim -- this is a wire format for
 *  direct engine-JSON consumption, not an app-domain type, so there's no camelCase translation
 *  layer to keep in sync as the engine's log format evolves. */

export type ReplayTeam = 'blue' | 'red'
export type SurvivalState = 'alive' | 'casualty' | 'dead'

export interface ReplayPosition {
  x: number
  y: number
  z: number
}

export interface ReplayCommunicationGroup {
  group_id: string
  name: string
  team: ReplayTeam
  member_indices: number[]
}

/** Row-major, one entry per width*height cell. */
export interface ReplayBattlefield {
  width: number
  height: number
  surface: ReplayPosition[]
  /** 0-9, same encoding as TERRAIN_CLASS in ./terrain. */
  terrain_classes: number[]
  communication_groups: ReplayCommunicationGroup[]
}

export interface ReplaySoldier {
  soldier_index: number
  team: ReplayTeam
  position: ReplayPosition
  survival_status: SurvivalState
}

export interface ReplayShot {
  shooter_index: number
  target_index: number
  shooter_position: ReplayPosition
  target_position: ReplayPosition
  hit: boolean
}

export interface ReplayMessage {
  sender_index: number
  group_id: string
  content: string
}

export interface ReplayStep {
  step: number
  soldiers: ReplaySoldier[]
  shots: ReplayShot[]
  messages: ReplayMessage[]
}

export interface ReplayLog {
  schema_version: 3
  battlefield: ReplayBattlefield
  steps: ReplayStep[]
}

/** Lightweight row for the Simulations list page -- no battlefield/steps payload. */
export interface SimulationRunSummary {
  id: string
  name: string
  battlegroundId: string
  battlegroundName: string
  stepCount: number
  soldierCount: number
  createdAt: string
}

/** Full replay + terrain snapshot as returned by GET /api/replays/:id. */
export interface SavedSimulationRun {
  run: { id: string; name: string; createdAt: string }
  replay: ReplayLog
  meta: BattlegroundMeta
  features: OsmFeatures
  grid: GridData
}
