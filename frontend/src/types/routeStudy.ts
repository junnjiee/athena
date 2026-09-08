import type { BBoxDeg } from './terrain'

export interface OperationalAreaMeta {
  id: string
  name: string
  bbox: BBoxDeg
  generatedAt: string
  nodeCount: number
  edgeCount: number
  demResolutionMeters: number
}

export interface GraphNode {
  id: number
  lon: number
  lat: number
  elevation: number
}

export interface GraphEdge {
  id: string
  wayId: number
  from: number
  to: number
  roadClass: string
  nodes: number[]
  points: [number, number][]
  lengthMeters: number
}

export interface RoadGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface StudyMark {
  id: string
  name: string
  lon: number
  lat: number
}

export interface StudyMarks {
  reserves: StudyMark[]
  objectives: StudyMark[]
}

export interface StudyRoute {
  reserve_id: string
  objective_id: string
  edge_ids: string[]
  node_ids: number[]
  seconds: number
  length_meters: number
}

export interface Corridor {
  id: string
  routes: StudyRoute[]
  choke_edge_ids: string[]
  fastest_seconds: number
}

export interface UnreachablePair {
  reserve_id: string
  objective_id: string
  reason: string
}

export interface StudyResult {
  corridors: Corridor[]
  unreachable: UnreachablePair[]
}

export interface CorridorEdit {
  name?: string
  category?: string
}

export interface RouteStudySummary {
  id: string
  areaId: string
  name: string
  updatedAt: string
}

export interface RouteStudy {
  id: string
  areaId: string
  name: string
  marks: StudyMarks
  edgeOverrides: string[]
  result: StudyResult
  corridorEdits: Record<string, CorridorEdit>
}

export type OperationalToolMode =
  | 'navigate'
  | 'select-area'
  | 'place-reserve'
  | 'place-study-objective'

export type StudyMarkKind = 'reserve' | 'objective'

// Short aliases used by the route-study store and panels.
export type Mark = StudyMark
export type MarkKind = StudyMarkKind
