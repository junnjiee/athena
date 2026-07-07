import { fileURLToPath } from 'node:url'
import Piscina from 'piscina'
import { config } from '../config'
import type { SegmentationResult } from '../types'
import type { CellSpectral } from '../services/satellite'
import type { LosTerrain, Observer, ViewshedOptions } from '../services/los'

export interface SegmentTaskWire {
  kind: 'segment'
  width: number
  height: number
  rgb: ArrayBuffer
  tex: ArrayBuffer
}

export interface DangerTaskWire {
  kind: 'danger'
  width: number
  height: number
  cellMeters: number
  elevation: ArrayBuffer
  cls: ArrayBuffer
  observers: Observer[]
  targetHeightM?: number
  maxRangeM?: number
}

export type WorkerTask = SegmentTaskWire | DangerTaskWire

interface SegmentResultWire {
  cls: Uint8Array
  confidence: Uint8Array
}

let pool: Piscina | null = null
let poolBroken = false

function getPool(): Piscina {
  pool ??= new Piscina({
    filename: fileURLToPath(new URL('./segmentWorker.ts', import.meta.url)),
    maxThreads: config.segWorkerThreads,
    // Workers are TypeScript — boot them through the same tsx loader the
    // server process runs under.
    execArgv: ['--import', 'tsx'],
  })
  return pool
}

async function runTask<T>(task: WorkerTask, transferList: ArrayBuffer[]): Promise<T | null> {
  if (poolBroken) return null
  try {
    return (await getPool().run(task, { transferList })) as T
  } catch (error: unknown) {
    poolBroken = true
    console.warn(
      '[pool] worker unavailable, running in-process:',
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

/** Run segmentation off the event loop, transferring raster buffers zero-copy.
 *  Falls back to in-process execution if the pool cannot boot. */
export async function runSegmentationInPool(input: CellSpectral): Promise<SegmentationResult> {
  const task: SegmentTaskWire = {
    kind: 'segment',
    width: input.width,
    height: input.height,
    rgb: input.rgb.buffer as ArrayBuffer,
    tex: input.tex.buffer as ArrayBuffer,
  }
  const result = await runTask<SegmentResultWire>(task, [task.rgb, task.tex])
  if (result) return { cls: new Uint8Array(result.cls), confidence: new Uint8Array(result.confidence) }

  const { segmentGrid } = await import('../services/segment')
  return segmentGrid(input)
}

/** Run a multi-observer danger field off the event loop. The terrain buffers are
 *  COPIED (not transferred) because the caller's grid channels stay cached on
 *  the job and must survive repeated danger requests. */
export async function runDangerFieldInPool(
  terrain: LosTerrain,
  observers: Observer[],
  options: ViewshedOptions = {},
): Promise<Uint8Array> {
  const elevation = terrain.elevation.slice()
  const cls = terrain.cls.slice()
  const task: DangerTaskWire = {
    kind: 'danger',
    width: terrain.width,
    height: terrain.height,
    cellMeters: terrain.cellMeters,
    elevation: elevation.buffer as ArrayBuffer,
    cls: cls.buffer as ArrayBuffer,
    observers,
    targetHeightM: options.targetHeightM,
    maxRangeM: options.maxRangeM,
  }
  const result = await runTask<Uint8Array>(task, [task.elevation, task.cls])
  if (result) return new Uint8Array(result)

  const { computeDangerField } = await import('../services/los')
  return computeDangerField(terrain, observers, options)
}
