import { segmentGrid } from '../services/segment'
import { computeDangerField, type Observer, type ViewshedOptions } from '../services/los'
import type { SegmentationResult } from '../types'
import type { DangerTaskWire, SegmentTaskWire, WorkerTask } from './pool'

function runSegment(task: SegmentTaskWire): Promise<SegmentationResult> {
  return segmentGrid({
    width: task.width,
    height: task.height,
    rgb: new Uint8Array(task.rgb),
    tex: new Uint8Array(task.tex),
  })
}

function runDanger(task: DangerTaskWire): Uint8Array {
  const options: ViewshedOptions = { maxRangeM: task.maxRangeM, targetHeightM: task.targetHeightM }
  return computeDangerField(
    {
      width: task.width,
      height: task.height,
      cellMeters: task.cellMeters,
      elevation: new Float32Array(task.elevation),
      cls: new Uint8Array(task.cls),
    },
    task.observers as Observer[],
    options,
  )
}

/** Piscina entry point: CPU-heavy terrain work dispatched off the event loop. */
export default async function run(task: WorkerTask): Promise<SegmentationResult | Uint8Array> {
  if (task.kind === 'segment') return runSegment(task)
  return runDanger(task)
}
