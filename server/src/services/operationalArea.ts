import { randomUUID } from 'node:crypto'
import { LruCache } from '../lib/lru'
import { config } from '../config'
import { buildElevationSampler } from './dem'
import { fetchOperationalRoads } from './operationalOsm'
import { attachElevations, buildRoadGraph } from './roadGraph'
import { persistOperationalArea } from './operationalAreaStore'
import type {
  BBox,
  OperationalAreaJob,
  OperationalAreaMeta,
  OverpassWay,
  ProgressEvent,
  ProgressStepId,
  RoadGraph,
} from '../types'

/**
 * Ingests one operational area: the drivable road network over a wide box,
 * built into a routable graph with node elevations.
 *
 * Every stage is fatal on failure. The terrain pipeline deliberately degrades
 * when a source is unavailable, because a missing building is cosmetic; here a
 * missing road is a corridor absent from the analysis but present on the
 * ground, in a product whose claim is that it enumerated the approaches. A
 * partial area is never written.
 */

export interface OperationalAreaResult {
  meta: OperationalAreaMeta
  graph: RoadGraph
}

type Emit = (step: ProgressStepId, status: 'start' | 'done' | 'error', detail?: string) => void

interface Deps {
  fetchRoads?: (bbox: BBox) => Promise<OverpassWay[]>
  buildSampler?: (
    bbox: BBox,
    resolutionMeters: number,
  ) => Promise<(lon: number, lat: number) => number>
  emit?: Emit
}

export async function ingestOperationalArea(
  bbox: BBox,
  name: string,
  deps: Deps = {},
): Promise<OperationalAreaResult> {
  const fetchRoads = deps.fetchRoads ?? fetchOperationalRoads
  const buildSampler = deps.buildSampler ?? buildElevationSampler
  const emit: Emit = deps.emit ?? (() => {})

  emit('roads', 'start')
  const ways = await fetchRoads(bbox)
  emit('roads', 'done', `${ways.length} drivable ways`)

  emit('elevation', 'start')
  const sample = await buildSampler(bbox, config.operationalDemResolutionMeters)
  emit('elevation', 'done', `${config.operationalDemResolutionMeters} m DEM`)

  emit('graph', 'start')
  const graph = attachElevations(buildRoadGraph(ways), sample)
  if (graph.edges.length === 0) {
    // Distinct from "no routes found": an empty graph would report as an
    // absence of reinforcement options rather than an absence of data.
    throw new Error('no drivable roads found over this ground')
  }
  emit('graph', 'done', `${graph.nodes.length} junctions, ${graph.edges.length} edges`)

  return {
    meta: {
      id: randomUUID(),
      name,
      bbox,
      generatedAt: new Date().toISOString(),
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      demResolutionMeters: config.operationalDemResolutionMeters,
      roadTheme: 'raptors',
      roadEdits: {},
    },
    graph,
  }
}

// --- Job orchestration -------------------------------------------------------
//
// Mirrors services/pipeline.ts: the ingest runs in the background, progress is
// pushed to a listener and recorded on the job for late subscribers, and the
// caller gets an id immediately. Unlike the terrain pipeline, a failure marks
// the job errored rather than continuing with less data.


export type ProgressListener = (jobId: string, event: ProgressEvent) => void

const jobs = new LruCache<OperationalAreaJob>(config.jobCacheSize)

export function getOperationalAreaJob(id: string): OperationalAreaJob | undefined {
  return jobs.get(id)
}

export function startOperationalAreaIngest(
  bbox: BBox,
  name: string,
  onProgress: ProgressListener,
): OperationalAreaJob {
  const id = randomUUID()
  const job: OperationalAreaJob = {
    id,
    status: 'running',
    progress: [],
    meta: null,
    graph: null,
  }
  jobs.set(id, job)

  const emit: Emit = (step, status, detail) => {
    const event: ProgressEvent = { step, status, detail, t: Date.now() }
    job.progress.push(event)
    onProgress(id, event)
  }

  void (async () => {
    try {
      const result = await ingestOperationalArea(bbox, name, { emit })
      // The job keeps the ingest's own id out of the way: callers already hold
      // the job id, and two ids for one area invites fetching the wrong one.
      const meta = { ...result.meta, id }
      // Persisted before the job reports ready: an area that cannot be stored
      // is not one a study can be built against later.
      await persistOperationalArea(meta, result.graph)
      job.meta = meta
      job.graph = result.graph
      job.status = 'ready'
    } catch (error: unknown) {
      job.status = 'error'
      job.error = error instanceof Error ? error.message : String(error)
      emit('graph', 'error', job.error)
    }
  })()

  return job
}
