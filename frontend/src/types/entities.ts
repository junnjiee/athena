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
}

export type ToolMode = 'navigate' | 'select-ground' | 'place-blue' | 'place-red' | 'place-objective' | 'draw-route'
