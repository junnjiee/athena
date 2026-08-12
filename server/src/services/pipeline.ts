import { randomUUID } from 'node:crypto'
import { config } from '../config'
import { bboxExtentMeters } from '../lib/geo'
import { LruCache } from '../lib/lru'
import type { BattlegroundJob, BBox, ProgressEvent, ProgressStepId } from '../types'
import { buildGridChannels } from './classify'
import { buildHeightGrid } from './dem'
import { packGrid } from './grid'
import { fetchLandCoverGrid } from './landcover'
import { fetchOsmFeatures } from './osm'
import { segmentBattlefield, type SegmentationStage } from './segment'
import { fetchWeather } from './weather'
import { persistBattleground } from './battlegroundStore'

export type ProgressListener = (jobId: string, event: ProgressEvent) => void

const jobs = new LruCache<BattlegroundJob>(config.jobCacheSize)
/** Completed results keyed by rounded bbox so re-selecting the same ground is instant. */
const resultCache = new LruCache<BattlegroundJob>(config.jobCacheSize)

function cacheKey(bbox: BBox): string {
  const r = (v: number) => v.toFixed(5)
  return `${r(bbox.west)},${r(bbox.south)},${r(bbox.east)},${r(bbox.north)}`
}

export function getJob(id: string): BattlegroundJob | undefined {
  return jobs.get(id)
}

/** Terrain is durable the moment it exists, so a plan saved against it never
 *  depends on this process still holding the job. Failing to persist must not
 *  fail the generation the operator is watching — the grid is served from the
 *  job either way, and the next save reports the problem. */
function persist(job: BattlegroundJob): Promise<void> {
  return persistBattleground(job).catch((error: unknown) => {
    console.error(`[pipeline] could not persist battleground ${job.id}:`, error)
  })
}

function gridDimensions(bbox: BBox): { width: number; height: number; cellMeters: number } {
  const { widthM, heightM } = bboxExtentMeters(bbox)
  const cellMeters = config.cellMeters
  return {
    width: Math.max(8, Math.round(widthM / cellMeters)),
    height: Math.max(8, Math.round(heightM / cellMeters)),
    cellMeters,
  }
}

/** Start battleground generation. Returns immediately with the job (status=running);
 *  progress is pushed through `onProgress` and recorded on the job for late subscribers. */
export function startPipeline(bbox: BBox, name: string, onProgress: ProgressListener): BattlegroundJob {
  const cached = resultCache.get(cacheKey(bbox))
  if (cached && cached.status === 'ready' && cached.meta) {
    // Re-issue under a fresh id, reusing the computed grid — same ground, zero latency.
    const id = randomUUID()
    const job: BattlegroundJob = { ...cached, id, progress: [], meta: { ...cached.meta, id, name } }
    jobs.set(id, job)
    // A re-issue is a new battleground id, so it needs its own row: a plan saved
    // against it must not depend on this process still holding the job.
    void persist(job)
    return job
  }

  const job: BattlegroundJob = {
    id: randomUUID(),
    status: 'running',
    progress: [],
    meta: null,
    gridBuffer: null,
    features: null,
  }
  jobs.set(job.id, job)
  void runPipeline(job, bbox, name, onProgress)
  return job
}

async function runPipeline(
  job: BattlegroundJob,
  bbox: BBox,
  name: string,
  onProgress: ProgressListener,
): Promise<void> {
  const emit = (step: ProgressStepId, status: ProgressEvent['status'], detail?: string) => {
    const event: ProgressEvent = { step, status, detail, t: Date.now() }
    job.progress.push(event)
    onProgress(job.id, event)
  }

  try {
    const { width, height, cellMeters } = gridDimensions(bbox)
    const midLat = (bbox.south + bbox.north) / 2
    const midLon = (bbox.west + bbox.east) / 2

    emit('elevation', 'start')
    emit('features', 'start')
    emit('landcover', 'start')
    emit('segment', 'start')
    emit('weather', 'start')
    const [heights, features, landCover, segmentation, weather] = await Promise.all([
      buildHeightGrid(bbox, width, height, cellMeters).then((h) => {
        emit('elevation', 'done', `${width}×${height} @ ${cellMeters.toFixed(1)} m`)
        return h
      }),
      fetchOsmFeatures(bbox)
        .then((f) => {
          emit('features', 'done', `${f.buildings.length} buildings, ${f.roads.length} roads`)
          return f
        })
        .catch((error: unknown) => {
          // OSM being throttled must not sink the battlefield — degrade to
          // elevation-only classification and say so.
          console.warn('[pipeline] OSM unavailable, continuing without features:', error)
          emit('features', 'done', 'limited data — OSM unavailable')
          const empty: Awaited<ReturnType<typeof fetchOsmFeatures>> = {
            roads: [],
            buildings: [],
            areas: [],
            waterLines: [],
          }
          return empty
        }),
      fetchLandCoverGrid(bbox, width, height).then((lc) => {
        emit('landcover', 'done', lc ? 'satellite land-cover sampled' : 'unavailable — OSM-only fallback')
        return lc
      }),
      segmentBattlefield(bbox, width, height, cellMeters).then((stage: SegmentationStage) => {
        emit(
          'segment',
          'done',
          stage.info
            ? `${stage.info.backend} · ${stage.info.coveragePct}% confident coverage`
            : 'unavailable — WorldCover prior only',
        )
        return stage
      }),
      fetchWeather(midLat, midLon).then((w) => {
        emit('weather', 'done', w ? `${w.temperatureC.toFixed(0)}°C, wind ${w.windSpeedKmh.toFixed(0)} km/h` : 'unavailable')
        return w
      }),
    ])

    emit('classify', 'start')
    const channels = buildGridChannels(
      bbox,
      width,
      height,
      cellMeters,
      heights,
      features,
      landCover,
      segmentation.seg,
    )
    emit('classify', 'done', `${features.areas.length} land-cover polygons`)

    emit('military', 'start')
    // Property computation happens inside buildGridChannels; this step exists so the
    // UI can narrate the phases distinctly without a second full pass.
    emit('military', 'done', 'cover · concealment · mobility · visibility')

    emit('grid', 'start')
    job.gridBuffer = packGrid(channels, width, height, cellMeters)
    job.meta = {
      id: job.id,
      name,
      bbox,
      width,
      height,
      cellMeters,
      generatedAt: new Date().toISOString(),
      weather,
      featureCounts: {
        roads: features.roads.length,
        buildings: features.buildings.length,
        areas: features.areas.length,
      },
      segmentation: segmentation.info,
    }
    job.features = features
    job.status = 'ready'
    emit('grid', 'done', `${((job.gridBuffer.length) / 1024).toFixed(0)} KB simulation grid`)
    resultCache.set(cacheKey(bbox), job)
    void persist(job)
  } catch (error: unknown) {
    job.status = 'error'
    job.error = error instanceof Error ? error.message : 'pipeline failed'
    console.error(`[pipeline] job ${job.id} failed:`, error)
    emit('grid', 'error', job.error)
  }
}
