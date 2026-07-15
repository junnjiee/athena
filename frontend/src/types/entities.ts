import type { MovementLoadout, MovementType } from './movement'

export interface LonLat {
  longitude: number
  latitude: number
}

export type ForceSide = 'blue' | 'red'

export interface PlacedUnit {
  id: string
  side: ForceSide
  name: string
  typeLabel: string
  position: LonLat
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

export type ToolMode = 'navigate' | 'select-ground' | 'place-blue' | 'place-red' | 'place-objective' | 'draw-route'
