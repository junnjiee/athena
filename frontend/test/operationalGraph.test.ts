import { afterEach, describe, expect, test } from 'bun:test'
import { gzipSync } from 'node:zlib'
import { decodeOperationalGraph, fetchOperationalGraph } from '../src/lib/api'
import type { RoadGraph } from '../src/types/routeStudy'

const graph: RoadGraph = {
  nodes: [{ id: 1, lon: 103.7, lat: 1.3, elevation: 14 }],
  edges: [],
}

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

describe('operational graph decoding', () => {
  test('accepts plain JSON when an intermediary already decompressed the response', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(graph))
    expect(await decodeOperationalGraph(asArrayBuffer(bytes))).toEqual(graph)
  })

  test('decompresses the server’s application/gzip payload', async () => {
    const bytes = gzipSync(JSON.stringify(graph))
    expect(await decodeOperationalGraph(asArrayBuffer(bytes))).toEqual(graph)
  })

  test('requests the immutable revision a study was pinned to', async () => {
    let requested = ''
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested = String(input)
      return new Response(JSON.stringify(graph))
    }) as typeof fetch

    await fetchOperationalGraph('ao-1', 7)

    expect(requested).toBe('/api/operational-area/ao-1/graph?revision=7')
  })
})
