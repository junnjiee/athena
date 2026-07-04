/** Geographic bounding box in degrees. */
export interface BBox {
  west: number
  south: number
  east: number
  north: number
}

/** Terrain class ids — stable contract with the frontend, do not renumber. */
export const TERRAIN_CLASS = {
  OPEN: 0,
  GRASS: 1,
  SCRUB: 2,
  FOREST: 3,
  WETLAND: 4,
  WATER: 5,
  URBAN: 6,
  BUILDING: 7,
  ROAD: 8,
  BARREN: 9,
} as const

export type TerrainClassId = (typeof TERRAIN_CLASS)[keyof typeof TERRAIN_CLASS]

export type RoadClass = 'major' | 'minor' | 'track' | 'path'

export type AreaKind =
  | 'forest'
  | 'scrub'
  | 'grass'
  | 'water'
  | 'wetland'
  | 'urban'
  | 'barren'

export interface OsmRoad {
  roadClass: RoadClass
  name?: string
  /** [lon, lat] vertices */
  points: [number, number][]
}

export interface OsmBuilding {
  /** Closed ring of [lon, lat]; first point not repeated at end. */
  footprint: [number, number][]
  heightMeters: number
}

export interface OsmArea {
  kind: AreaKind
  /** Closed ring of [lon, lat]; first point not repeated at end. */
  ring: [number, number][]
}

export interface OsmWaterLine {
  /** [lon, lat] vertices of rivers/streams treated as narrow water. */
  points: [number, number][]
}

export interface OsmFeatures {
  roads: OsmRoad[]
  buildings: OsmBuilding[]
  areas: OsmArea[]
  waterLines: OsmWaterLine[]
}

export interface Weather {
  temperatureC: number
  windSpeedKmh: number
  windDirectionDeg: number
  cloudCoverPct: number
  precipitationMm: number
  visibilityM: number
  isDay: boolean
}

/** Per-cell military property channels, all Uint8 except height. */
export interface GridChannels {
  height: Float32Array
  cls: Uint8Array
  /** slope in degrees, 0–90 */
  slope: Uint8Array
  /** 0–100 */
  cover: Uint8Array
  /** 0–100 */
  concealment: Uint8Array
  /** infantry movement cost ×20 (20 = ×1.0), capped 250 */
  moveCost: Uint8Array
  /** how visible/exposed a unit standing here is, 0–100 */
  visibility: Uint8Array
  /** vehicle mobility 0–100 */
  vehicleMobility: Uint8Array
  /** ambush potential 0–100 */
  ambush: Uint8Array
}

export interface GridMeta {
  id: string
  name: string
  bbox: BBox
  width: number
  height: number
  cellMeters: number
  generatedAt: string
  weather: Weather | null
  featureCounts: { roads: number; buildings: number; areas: number }
}

export type ProgressStepId =
  | 'elevation'
  | 'features'
  | 'weather'
  | 'classify'
  | 'military'
  | 'grid'

export interface ProgressEvent {
  step: ProgressStepId
  status: 'start' | 'done' | 'error'
  detail?: string
  t: number
}

export interface BattlegroundJob {
  id: string
  status: 'running' | 'ready' | 'error'
  error?: string
  progress: ProgressEvent[]
  meta: GridMeta | null
  gridBuffer: Buffer | null
  features: OsmFeatures | null
}
