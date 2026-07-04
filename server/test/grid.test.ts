import { describe, expect, test } from 'bun:test'
import { packGrid, unpackGrid, GRID_HEADER_BYTES, U8_CHANNELS } from '../src/services/grid'
import type { GridChannels } from '../src/types'

function makeChannels(n: number): GridChannels {
  const rand8 = () => Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256))
  return {
    height: Float32Array.from({ length: n }, (_, i) => i * 1.5 - 100),
    cls: rand8(),
    slope: rand8(),
    cover: rand8(),
    concealment: rand8(),
    moveCost: rand8(),
    visibility: rand8(),
    vehicleMobility: rand8(),
    ambush: rand8(),
  }
}

describe('grid wire format', () => {
  test('pack → unpack round-trips every channel', () => {
    const w = 17
    const h = 13
    const channels = makeChannels(w * h)
    const buffer = packGrid(channels, w, h, 7.25)
    expect(buffer.length).toBe(GRID_HEADER_BYTES + w * h * 4 + w * h * U8_CHANNELS)

    const decoded = unpackGrid(buffer)
    expect(decoded.width).toBe(w)
    expect(decoded.height).toBe(h)
    expect(decoded.cellMeters).toBeCloseTo(7.25, 5)
    expect([...decoded.channels.height]).toEqual([...channels.height])
    expect([...decoded.channels.cls]).toEqual([...channels.cls])
    expect([...decoded.channels.ambush]).toEqual([...channels.ambush])
    expect([...decoded.channels.moveCost]).toEqual([...channels.moveCost])
  })

  test('rejects corrupt magic', () => {
    const buffer = packGrid(makeChannels(4), 2, 2, 5)
    buffer.writeUInt32LE(0xdeadbeef, 0)
    expect(() => unpackGrid(buffer)).toThrow('bad grid magic')
  })
})
