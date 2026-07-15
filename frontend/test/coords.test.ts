import { describe, expect, test } from 'bun:test'
import * as mgrs from 'mgrs'
import { toGridRef, toMGRS } from '../src/lib/coords'

// Western Singapore, the default demo AO.
const LON = 103.72
const LAT = 1.31

describe('toMGRS', () => {
  test('formats with NATO spacing at 10 m precision', () => {
    const result = toMGRS(LON, LAT)
    expect(result).toMatch(/^48N [A-Z]{2} \d{4} \d{4}$/)
  })

  test('supports 1 m and 100 m precision', () => {
    expect(toMGRS(LON, LAT, 5)).toMatch(/^48N [A-Z]{2} \d{5} \d{5}$/)
    expect(toMGRS(LON, LAT, 3)).toMatch(/^48N [A-Z]{2} \d{3} \d{3}$/)
  })

  test('round-trips back to the source point within precision', () => {
    const compact = toMGRS(LON, LAT, 5).replace(/ /g, '')
    const [lon, lat] = mgrs.toPoint(compact)
    expect(lon).toBeCloseTo(LON, 4)
    expect(lat).toBeCloseTo(LAT, 4)
  })

  test('works in the southern hemisphere', () => {
    // Shoalwater Bay, Australia (Ex Wallaby country)
    expect(toMGRS(150.3, -22.7)).toMatch(/^56K [A-Z]{2} \d{4} \d{4}$/)
  })
})

describe('toGridRef', () => {
  test('reads as a spoken six-figure grid reference', () => {
    expect(toGridRef(LON, LAT)).toMatch(/^GR \d{3} \d{3}$/)
  })

  test('agrees with the 100 m MGRS numerals', () => {
    const gr = toGridRef(LON, LAT)
    const full = toMGRS(LON, LAT, 3)
    expect(full.endsWith(gr.replace('GR ', ''))).toBe(true)
  })
})
