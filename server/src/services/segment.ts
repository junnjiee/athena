import { config } from '../config'
import { TERRAIN_CLASS, type BBox, type SegmentationInfo, type SegmentationResult } from '../types'
import { LANDCOVER_NONE } from './landcover'
import { buildSpectralGrid, type CellSpectral } from './satellite'
import { runSegmentationInPool } from '../workers/pool'

const C = TERRAIN_CLASS

/** "No confident call" sentinel — shared with the WorldCover fallback so the
 *  classifier treats both rasters uniformly. */
export const SEG_NONE = LANDCOVER_NONE

export interface PixelCall {
  cls: number
  /** 0-100 */
  conf: number
}

/** Deterministic spectral classifier for one cell's mean RGB + texture.
 *
 *  This is the default backend: honest rules over excess-green, blue dominance,
 *  brightness and local texture. It is deliberately conservative — confidence
 *  below config.segConfidenceMin falls through to the WorldCover prior in
 *  classify.ts, so a weak call here never degrades classification. Swap in a
 *  trained model via the ONNX backend below for real perception. */
export function classifySpectralPixel(r: number, g: number, b: number, tex: number): PixelCall {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  const exg = 2 * g - r - b // excess green index
  const blueDom = b - Math.max(r, g)
  const chroma = Math.max(r, g, b) - Math.min(r, g, b)

  // Water: blue-dominant, or very dark & smooth (deep/shadowed channels).
  if (blueDom >= 8 && luma < 140) {
    return { cls: C.WATER, conf: Math.min(95, 45 + blueDom * 2) }
  }
  if (luma < 50 && tex < 10 && exg < 18) {
    return { cls: C.WATER, conf: 45 }
  }

  // Vegetation: dark or rough canopy = forest, bright smooth = grass.
  if (exg >= 22) {
    if (luma < 90 || tex >= 26) {
      const darkness = Math.max(0, 90 - luma) * 0.4
      return { cls: C.FOREST, conf: Math.min(95, Math.round(40 + exg * 0.5 + darkness + tex * 0.5)) }
    }
    if (luma >= 150) return { cls: C.GRASS, conf: Math.min(90, Math.round(35 + exg * 0.4)) }
    return { cls: C.SCRUB, conf: Math.min(80, Math.round(30 + exg * 0.4)) }
  }

  // Barren/sand: warm, bright, low-green.
  if (luma >= 140 && exg < 25 && r >= g && g >= b) {
    return { cls: C.BARREN, conf: Math.min(85, Math.round(30 + (luma - 140) * 0.6 + (r - b) * 0.5)) }
  }

  // Urban: neutral gray, mid brightness, strongly textured (roof/road clutter).
  // Deliberately conservative — gray dirt tracks in plantation country also look
  // "gray + textured", so only heavy clutter clears the fusion gate; weaker calls
  // defer to the WorldCover prior.
  if (chroma <= 20 && luma >= 90 && luma <= 190 && tex >= 20) {
    return { cls: C.URBAN, conf: Math.min(65, Math.round(20 + tex)) }
  }

  return { cls: SEG_NONE, conf: 0 }
}

/** Run the configured backend over a spectral grid. Pure w.r.t. its input —
 *  safe to call from a worker thread. */
export async function segmentGrid(input: CellSpectral): Promise<SegmentationResult> {
  if (config.segModelPath) return onnxSegment(input, config.segModelPath)
  return spectralSegment(input)
}

export function spectralSegment(input: CellSpectral): SegmentationResult {
  const n = input.width * input.height
  const cls = new Uint8Array(n).fill(SEG_NONE)
  const confidence = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const call = classifySpectralPixel(
      input.rgb[i * 3],
      input.rgb[i * 3 + 1],
      input.rgb[i * 3 + 2],
      input.tex[i],
    )
    cls[i] = call.cls
    confidence[i] = call.conf
  }
  return { cls, confidence }
}

/** ONNX backend contract (set ATHENA_SEG_MODEL to enable, requires
 *  `bun add onnxruntime-node`):
 *    input:  float32 [1, 3, R, R]  RGB normalized to 0-1, R = ATHENA_SEG_RES (512)
 *    output: float32 [1, C, R, R]  per-class logits
 *  ATHENA_SEG_CLASSMAP is a JSON array of length C mapping each output channel
 *  to a TERRAIN_CLASS id (255 = ignore channel). Confidence is the softmax
 *  margin between the top two classes. */
async function onnxSegment(input: CellSpectral, modelPath: string): Promise<SegmentationResult> {
  const ort = await import('onnxruntime-node')
  const res = config.segModelResolution
  const classMap: number[] = config.segModelClassMap
    ? (JSON.parse(config.segModelClassMap) as number[])
    : []

  // Nearest-resample the cell RGB grid to the model's square input.
  const tensorData = new Float32Array(3 * res * res)
  for (let y = 0; y < res; y++) {
    const srcRow = Math.min(input.height - 1, Math.floor((y / res) * input.height))
    for (let x = 0; x < res; x++) {
      const srcCol = Math.min(input.width - 1, Math.floor((x / res) * input.width))
      const src = (srcRow * input.width + srcCol) * 3
      const dst = y * res + x
      tensorData[dst] = input.rgb[src] / 255
      tensorData[res * res + dst] = input.rgb[src + 1] / 255
      tensorData[2 * res * res + dst] = input.rgb[src + 2] / 255
    }
  }

  const session = await ort.InferenceSession.create(modelPath)
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', tensorData, [1, 3, res, res]) }
  const outputs = await session.run(feeds)
  const logits = outputs[session.outputNames[0]]
  const channels = Number(logits.dims[1])

  const n = input.width * input.height
  const cls = new Uint8Array(n).fill(SEG_NONE)
  const confidence = new Uint8Array(n)
  for (let row = 0; row < input.height; row++) {
    const my = Math.min(res - 1, Math.floor((row / input.height) * res))
    for (let col = 0; col < input.width; col++) {
      const mx = Math.min(res - 1, Math.floor((col / input.width) * res))
      let best = -Infinity
      let second = -Infinity
      let bestC = 0
      for (let c = 0; c < channels; c++) {
        const v = logits.data[c * res * res + my * res + mx]
        if (v > best) {
          second = best
          best = v
          bestC = c
        } else if (v > second) {
          second = v
        }
      }
      const mapped = classMap[bestC] ?? SEG_NONE
      if (mapped === SEG_NONE) continue
      const i = row * input.width + col
      cls[i] = mapped
      // softmax margin of top-2 ≈ 1/(1+e^(second-best)); scale to 0-100
      confidence[i] = Math.round(100 / (1 + Math.exp(second - best)))
    }
  }
  return { cls, confidence }
}

export interface SegmentationStage {
  seg: SegmentationResult | null
  info: SegmentationInfo | null
}

/** Pipeline-facing orchestrator: fetch imagery, segment in the worker pool,
 *  summarize coverage. Never throws — segmentation is enrichment; any failure
 *  degrades to the WorldCover-prior behavior unchanged. */
export async function segmentBattlefield(
  bbox: BBox,
  width: number,
  height: number,
  cellMeters: number,
): Promise<SegmentationStage> {
  try {
    const spectral = await buildSpectralGrid(bbox, width, height, cellMeters)
    const seg = await runSegmentationInPool(spectral)
    let confident = 0
    for (let i = 0; i < seg.cls.length; i++) {
      if (seg.cls[i] !== SEG_NONE && seg.confidence[i] >= config.segConfidenceMin) confident++
    }
    const info: SegmentationInfo = {
      backend: config.segModelPath ? 'onnx' : 'spectral',
      coveragePct: Math.round((confident / seg.cls.length) * 100),
    }
    return { seg, info }
  } catch (error: unknown) {
    console.warn(
      '[segment] stage failed, degrading to WorldCover prior:',
      error instanceof Error ? error.message : error,
    )
    return { seg: null, info: null }
  }
}
