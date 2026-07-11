import { fileURLToPath } from 'node:url'
import Piscina from 'piscina'
import { config } from '../config'
import type { SegmentationResult } from '../types'
import type { CellSpectral } from '../services/satellite'

export interface SegmentTaskWire {
  width: number
  height: number
  rgb: ArrayBuffer
  tex: ArrayBuffer
}

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

/** Run segmentation off the event loop (Piscina worker thread), transferring the
 *  raster buffers zero-copy. Falls back to in-process execution if the worker
 *  pool cannot boot (e.g. running under a runtime without worker support) —
 *  correctness over latency. */
export async function runSegmentationInPool(input: CellSpectral): Promise<SegmentationResult> {
  if (!poolBroken) {
    try {
      const task: SegmentTaskWire = {
        width: input.width,
        height: input.height,
        rgb: input.rgb.buffer as ArrayBuffer,
        tex: input.tex.buffer as ArrayBuffer,
      }
      const result = (await getPool().run(task, {
        transferList: [task.rgb, task.tex],
      })) as SegmentResultWire
      return { cls: new Uint8Array(result.cls), confidence: new Uint8Array(result.confidence) }
    } catch (error: unknown) {
      poolBroken = true
      console.warn(
        '[pool] segmentation worker unavailable, running in-process:',
        error instanceof Error ? error.message : error,
      )
    }
  }
  const { segmentGrid } = await import('../services/segment')
  return segmentGrid(input)
}
