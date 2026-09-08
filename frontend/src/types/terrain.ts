/** Wire contract with athena-server — keep in sync with server/src/types.ts. */

export interface BBoxDeg {
  west: number
  south: number
  east: number
  north: number
}

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

export const TERRAIN_CLASS_NAMES: Record<number, string> = {
  [TERRAIN_CLASS.OPEN]: 'Open Ground',
  [TERRAIN_CLASS.GRASS]: 'Grassland',
  [TERRAIN_CLASS.SCRUB]: 'Scrub / Bush',
  [TERRAIN_CLASS.FOREST]: 'Dense Forest',
  [TERRAIN_CLASS.WETLAND]: 'Wetland',
  [TERRAIN_CLASS.WATER]: 'Water',
  [TERRAIN_CLASS.URBAN]: 'Urban Area',
  [TERRAIN_CLASS.BUILDING]: 'Structure',
  [TERRAIN_CLASS.ROAD]: 'Road',
  [TERRAIN_CLASS.BARREN]: 'Barren / Rock',
}

export type RoadClass = 'major' | 'minor' | 'track' | 'path'
export type AreaKind = 'forest' | 'scrub' | 'grass' | 'water' | 'wetland' | 'urban' | 'barren'

export interface OsmRoad {
  roadClass: RoadClass
  name?: string
  points: [number, number][]
}

export interface OsmBuilding {
  footprint: [number, number][]
  heightMeters: number
}

export interface OsmArea {
  kind: AreaKind
  ring: [number, number][]
}

export interface OsmFeatures {
  roads: OsmRoad[]
  buildings: OsmBuilding[]
  areas: OsmArea[]
  waterLines: { points: [number, number][] }[]
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

export interface BattlegroundMeta {
  id: string
  name: string
  bbox: BBoxDeg
  width: number
  height: number
  cellMeters: number
  generatedAt: string
  weather: Weather | null
  featureCounts: { roads: number; buildings: number; areas: number }
  /** live-imagery segmentation summary; null/absent when the stage was skipped */
  segmentation?: { backend: 'spectral' | 'onnx'; coveragePct: number } | null
}

/** Decoded simulation grid: row-major, row 0 = northernmost. */
export interface GridData {
  bbox: BBoxDeg
  width: number
  height: number
  cellMeters: number
  elevation: Float32Array
  cls: Uint8Array
  slope: Uint8Array
  cover: Uint8Array
  concealment: Uint8Array
  /** infantry movement cost ×20 (20 = ×1.0) */
  moveCost: Uint8Array
  visibility: Uint8Array
  vehicleMobility: Uint8Array
  ambush: Uint8Array
}

export interface CellSample {
  longitude: number
  latitude: number
  elevation: number
  slopeDeg: number
  cls: number
  clsName: string
  cover: number
  concealment: number
  /** unitless multiplier, 1.0 = clear ground walking pace */
  moveCostFactor: number
  visibility: number
  vehicleMobility: number
  ambush: number
}

export type ProgressStepId =
  | 'elevation'
  | 'roads'
  | 'graph'
  | 'features'
  | 'landcover'
  | 'weather'
  | 'segment'
  | 'classify'
  | 'military'
  | 'grid'

export interface ProgressEvent {
  step: ProgressStepId
  status: 'start' | 'done' | 'error'
  detail?: string
  t: number
}

export type StepStatus = 'pending' | 'active' | 'done' | 'error'

export interface ReasoningStep {
  id: ProgressStepId
  label: string
  status: StepStatus
  detail?: string
}

export type HeatmapMetric =
  | 'none'
  | 'cover'
  | 'concealment'
  | 'movement'
  | 'visibility'
  | 'vehicle'
  | 'ambush'
  | 'slope'
  | 'elevation'
  | 'contours'
  | 'landcover'
