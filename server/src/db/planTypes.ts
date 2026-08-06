/** Wire contract with the frontend for a saved plan's contents — kept in sync
 *  with frontend/src/types/entities.ts and frontend/src/types/movement.ts.
 *  The server never inspects these fields, only stores/returns them as jsonb,
 *  but typing them here keeps db/schema.ts and routes/plans.ts honest. */

export interface LonLat {
  longitude: number
  latitude: number
}

export type ForceSide = 'blue' | 'red'

export type SymbolKind = 'blueSection' | 'bluePlatoon' | 'redSection' | 'redPlatoon' | 'trench' | 'preparedTrench'

export interface PlacedUnit {
  id: string
  side: ForceSide
  name: string
  typeLabel: string
  position: LonLat
  symbolKind: SymbolKind
  rotationRadians: number
  /** ORBAT establishment fields; absent on fortifications and on plans saved
   *  before unit templates existed. */
  templateId?: string
  /** soldiers in the unit — one simulation agent each */
  strength?: number
  /** maps to the engine Soldier's vision_range, metres */
  visionRangeM?: number
}

export interface PlacedObjective {
  id: string
  name: string
  description: string
  position: LonLat
  radiusMeters: number
}

export type RouteEndpointRef = { kind: 'unit'; id: string } | { kind: 'objective'; id: string }

export type MovementType = 'prowl' | 'patrol' | 'charge'
export type LoadPreset = 'light' | 'fighting' | 'approach' | 'custom'

export interface MovementLoadout {
  bodyMassKg: number
  loadMassKg: number
  preset: LoadPreset
}

export interface PlacedRoute {
  id: string
  side: ForceSide
  startUnitId: string
  points: LonLat[]
  endRef: RouteEndpointRef | null
  movementType: MovementType
  loadout: MovementLoadout
}
