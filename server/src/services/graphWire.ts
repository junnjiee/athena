import { gunzipSync, gzipSync } from 'node:zlib'
import type { RoadGraph } from '../types'

/**
 * How a road graph is stored and handed to the engine.
 *
 * The terrain grid uses a custom binary layout because it is a fixed-size
 * channel per cell, where JSON would be pure overhead. A road graph is not that
 * shape: edges carry variable-length geometry, so a bespoke format would need
 * its own offset table and its own decoder in Python, for a one-off payload.
 *
 * Gzipped JSON gets most of the size win — a road network is mostly repeated
 * keys and clustered coordinates, which compresses hard — while staying
 * readable from any language with a JSON parser. Revisit only if a real graph
 * proves too slow to decode, not before.
 */

export function encodeGraph(graph: RoadGraph): Buffer {
  // Level 9 because an area is written once and read many times, and the
  // engine pulls it over the wire on every study.
  return gzipSync(Buffer.from(JSON.stringify(graph), 'utf8'), { level: 9 })
}

export function decodeGraph(packed: Buffer): RoadGraph {
  return JSON.parse(gunzipSync(packed).toString('utf8')) as RoadGraph
}
