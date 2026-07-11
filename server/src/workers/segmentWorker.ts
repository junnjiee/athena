import { segmentGrid } from '../services/segment'
import type { SegmentationResult } from '../types'
import type { SegmentTaskWire } from './pool'

/** Piscina entry point: reconstruct typed arrays from the transferred buffers
 *  and run the configured segmentation backend off the main event loop. */
export default async function run(task: SegmentTaskWire): Promise<SegmentationResult> {
  return segmentGrid({
    width: task.width,
    height: task.height,
    rgb: new Uint8Array(task.rgb),
    tex: new Uint8Array(task.tex),
  })
}
