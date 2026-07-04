import type { GridChannels } from '../types'

/** Binary grid wire format (little-endian), consumed by the frontend decoder:
 *  offset 0  u32  magic 0x41544847 ("ATHG")
 *  offset 4  u16  version (1)
 *  offset 6  u16  width
 *  offset 8  u16  height
 *  offset 10 u16  reserved
 *  offset 12 f32  cellMeters
 *  offset 16 f32[w*h]  height (meters)
 *  then 8 × u8[w*h]: cls, slope, cover, concealment, moveCost, visibility,
 *                    vehicleMobility, ambush
 */
export const GRID_MAGIC = 0x41544847
export const GRID_VERSION = 1
export const GRID_HEADER_BYTES = 16
export const U8_CHANNELS = 8

export function packGrid(channels: GridChannels, width: number, height: number, cellMeters: number): Buffer {
  const n = width * height
  const buffer = Buffer.alloc(GRID_HEADER_BYTES + n * 4 + n * U8_CHANNELS)
  buffer.writeUInt32LE(GRID_MAGIC, 0)
  buffer.writeUInt16LE(GRID_VERSION, 4)
  buffer.writeUInt16LE(width, 6)
  buffer.writeUInt16LE(height, 8)
  buffer.writeUInt16LE(0, 10)
  buffer.writeFloatLE(cellMeters, 12)

  Buffer.from(channels.height.buffer, channels.height.byteOffset, n * 4).copy(buffer, GRID_HEADER_BYTES)
  const u8Order = [
    channels.cls,
    channels.slope,
    channels.cover,
    channels.concealment,
    channels.moveCost,
    channels.visibility,
    channels.vehicleMobility,
    channels.ambush,
  ]
  u8Order.forEach((arr, i) => {
    Buffer.from(arr.buffer, arr.byteOffset, n).copy(buffer, GRID_HEADER_BYTES + n * 4 + i * n)
  })
  return buffer
}

/** Inverse of packGrid — used by tests to guarantee the wire format round-trips. */
export function unpackGrid(buffer: Buffer): { width: number; height: number; cellMeters: number; channels: GridChannels } {
  if (buffer.readUInt32LE(0) !== GRID_MAGIC) throw new Error('bad grid magic')
  if (buffer.readUInt16LE(4) !== GRID_VERSION) throw new Error('unsupported grid version')
  const width = buffer.readUInt16LE(6)
  const height = buffer.readUInt16LE(8)
  const cellMeters = buffer.readFloatLE(12)
  const n = width * height

  const heightArr = new Float32Array(n)
  for (let i = 0; i < n; i++) heightArr[i] = buffer.readFloatLE(GRID_HEADER_BYTES + i * 4)
  const u8Base = GRID_HEADER_BYTES + n * 4
  const readU8 = (channel: number) =>
    new Uint8Array(buffer.subarray(u8Base + channel * n, u8Base + (channel + 1) * n))

  return {
    width,
    height,
    cellMeters,
    channels: {
      height: heightArr,
      cls: readU8(0),
      slope: readU8(1),
      cover: readU8(2),
      concealment: readU8(3),
      moveCost: readU8(4),
      visibility: readU8(5),
      vehicleMobility: readU8(6),
      ambush: readU8(7),
    },
  }
}
