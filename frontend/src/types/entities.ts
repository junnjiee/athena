import type { MovementLoadout, MovementType } from './movement'

export interface LonLat {
  longitude: number
  latitude: number
}

export type ForceSide = 'blue' | 'red'

/** Which symbol to render for a placed unit -- the SAF-requested tactical
 *  position graphics (section/platoon area positions, trench fortifications). */
export type SymbolKind = 'blueSection' | 'bluePlatoon' | 'redSection' | 'redPlatoon' | 'trench' | 'preparedTrench'

export interface PlacedUnit {
  id: string
  side: ForceSide
  name: string
  typeLabel: string
  position: LonLat
  symbolKind: SymbolKind
  /** Facing of the shape, clockwise-from-north radians (0 = default
   *  orientation) -- same convention as lib/bearing.ts's bearingRadians. */
  rotationRadians: number
}

export interface PlacedObjective {
  id: string
  name: string
  description: string
  position: LonLat
  radiusMeters: number
}

export type RouteEndpointRef = { kind: 'unit'; id: string } | { kind: 'objective'; id: string }

export interface PlacedRoute {
  id: string
  side: ForceSide
  startUnitId: string
  points: LonLat[]
  endRef: RouteEndpointRef | null
  /** the gait this leg is moved at (prowl, rush, ...). Defaults to march for
   *  routes created before movement types existed. */
  movementType: MovementType
  /** soldier mass model used for the cost estimate; carried so a future agent
   *  API can re-derive physiology from the drawn plan. */
  loadout: MovementLoadout
}

/** A route as completed by a drawing surface (3D globe click-waypoints or topo
 *  freehand sketch), before the page assigns it an id and stores it as a
 *  PlacedRoute. */
export interface NewRouteInput {
  side: ForceSide
  startUnitId: string
  points: LonLat[]
  endRef: RouteEndpointRef | null
  movementType: MovementType
  loadout: MovementLoadout
}

export type ToolMode =
  | 'navigate'
  | 'select-ground'
  | 'place-objective'
  | 'draw-route'
  | 'place-blue-section'
  | 'place-blue-platoon'
  | 'place-red-section'
  | 'place-red-platoon'
  | 'place-trench'
  | 'place-prepared-trench'

/** Every ToolMode that places a point marker via a plain click, on both the 3D
 *  globe and the 2D topo view -- everything except the general navigation modes
 *  and the multi-click/drag route-drawing mode. */
export type PlaceableMode = Exclude<ToolMode, 'navigate' | 'select-ground' | 'draw-route'>
