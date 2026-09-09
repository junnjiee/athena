import { describe, expect, test } from 'bun:test'
import {
  formatRoadCode,
  parseRoadCode,
  prefillRoadClassification,
} from '../src/lib/roadCodes'

describe('road code grammar', () => {
  test('parses single and dual carriageway codes', () => {
    expect(parseRoadCode('KRANJI(4 X)')).toEqual({
      name: 'KRANJI',
      width: 4,
      dual: false,
      type: 'X',
    })
    expect(parseRoadCode('BKE(6// X)')).toEqual({
      name: 'BKE',
      width: 6,
      dual: true,
      type: 'X',
    })
    expect(parseRoadCode('MANDAI(2 Z)')).toEqual({
      name: 'MANDAI',
      width: 2,
      dual: false,
      type: 'Z',
    })
  })

  test('normalises case and spacing when formatting', () => {
    expect(formatRoadCode({ name: '  falcon ', width: 4, dual: true, type: 'y' })).toBe(
      'FALCON(4// Y)',
    )
  })

  test('rejects widths and types outside the grammar', () => {
    expect(parseRoadCode('FALCON(8 X)')).toBeNull()
    expect(parseRoadCode('FALCON(4 Q)')).toBeNull()
    expect(parseRoadCode('FALCON 4 X')).toBeNull()
  })
})

describe('OSM prefill', () => {
  test('uses an explicit lane count before the highway-class fallback', () => {
    expect(prefillRoadClassification({ roadClass: 'residential', lanes: '4' })).toEqual({
      width: 4,
      dual: false,
      type: 'Y',
    })
    expect(prefillRoadClassification({ roadClass: 'track', lanes: '6;4' })).toEqual({
      width: 6,
      dual: false,
      type: 'Z',
    })
  })

  test('prefills major roads as all-weather and dual where appropriate', () => {
    expect(prefillRoadClassification({ roadClass: 'motorway' })).toEqual({
      width: 6,
      dual: true,
      type: 'X',
    })
    expect(prefillRoadClassification({ roadClass: 'secondary' })).toEqual({
      width: 4,
      dual: false,
      type: 'X',
    })
  })

  test('keeps tracks fair-weather and narrow', () => {
    expect(prefillRoadClassification({ roadClass: 'track' })).toEqual({
      width: 2,
      dual: false,
      type: 'Z',
    })
  })
})
