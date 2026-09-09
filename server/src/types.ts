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

/** Human-readable terrain class names — mirrors frontend/src/types/terrain.ts.
 *  Used wherever a payload leaves the service for a human or an LLM agent, so
 *  the consumer never has to carry the numeric class table itself. */
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
  /** null when the segmentation stage was skipped or failed */
  segmentation?: SegmentationInfo | null
}

/** Per-cell semantic segmentation output over the live satellite raster.
 *  cls uses TERRAIN_CLASS ids with 255 (= LANDCOVER_NONE) meaning "no call";
 *  confidence is 0-100. */
export interface SegmentationResult {
  cls: Uint8Array
  confidence: Uint8Array
}

export interface SegmentationInfo {
  backend: 'spectral' | 'onnx'
  /** share of cells (0-100) where segmentation made a confident call */
  coveragePct: number
}

export type ProgressStepId =
  | 'elevation'
  | 'features'
  | 'landcover'
  | 'weather'
  | 'segment'
  | 'classify'
  | 'military'
  | 'grid'
  | 'roads'
  | 'graph'

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

/** Road classes a vehicle can use, kept at OSM's own granularity because the
 *  routing speed table needs a motorway and a residential street to differ.
 *  Distinct from `RoadClass`, which coarsens roads for tactical display. */
export type MountedRoadClass =
  | 'motorway'
  | 'trunk'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'residential'
  | 'unclassified'
  | 'service'
  | 'living_street'
  | 'track'

/** An Overpass way carrying node refs alongside geometry. The tactical query
 *  asks for `out tags geom`, which omits node ids and leaves junctions
 *  inferable only by matching floats; routing needs the ids. */
export interface OverpassWay {
  id: number
  nodes: number[]
  geometry: { lon: number; lat: number }[]
  tags?: Record<string, string>
}

/** A junction, or the free end of a road. Interior shape points are not nodes.
 *
 *  Elevation lives here rather than on the edge so an edge's gradient is
 *  derived and signed, which keeps uphill and downhill distinguishable without
 *  storing the same slope twice. Zero until `attachElevations` has run. */
export interface GraphNode {
  id: number
  lon: number
  lat: number
  elevation: number
}

export interface GraphEdge {
  /** `wayId:startIndex` — derived, so a rebuild of unchanged ground reproduces it. */
  id: string
  wayId: number
  from: number
  to: number
  roadClass: MountedRoadClass
  /** Source labels kept for an operator-editable route code prefill. */
  name?: string | null
  lanes?: string | null
  /** every node id from `from` to `to` inclusive, interior shape points included */
  nodes: number[]
  points: [number, number][]
  lengthMeters: number
}

/** Nodes and edges are both sorted, so an unchanged area rebuilds identically. */
export interface RoadGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type RoadTheme = 'raptors' | 'big-cats' | 'weather' | 'trees'

export interface RoadEdit {
  name: string
  width: 2 | 4 | 6
  dual: boolean
  type: 'X' | 'Y' | 'Z'
}

/** An ingested operational area: the current head of a revisioned road graph. */
export interface OperationalAreaMeta {
  id: string
  name: string
  bbox: BBox
  generatedAt: string
  nodeCount: number
  edgeCount: number
  currentRevision: number
  /** Ground resolution of the DEM the node elevations were sampled from. */
  demResolutionMeters: number
  roadTheme: RoadTheme
  /** Sparse operator edits keyed by road identity, never by graph segment. */
  roadEdits: Record<string, RoadEdit>
}

export interface OperationalAreaJob {
  id: string
  status: 'running' | 'ready' | 'error'
  error?: string
  progress: ProgressEvent[]
  meta: OperationalAreaMeta | null
  graph: RoadGraph | null
}
