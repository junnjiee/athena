/** Wire contract for the engine's ReplayLog, schema_version 3 (engine/athena/models/replay.py)
 *  -- kept in sync with frontend/src/types/replay.ts. The server never inspects these fields
 *  beyond the zod validation in routes/replays.ts, only stores/returns them as jsonb, but typing
 *  them here keeps db/schema.ts and routes/replays.ts honest. Snake_case, matching the engine's
 *  JSON verbatim -- this is a wire format, not an app-domain type. */

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

export interface ReplayBattlefield {
  width: number
  height: number
  surface: ReplayPosition[]
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
