import { describe, expect, test } from 'bun:test'
import { ROAD_THEMES, nextRoadName } from '../src/lib/roadNames'

describe('road naming themes', () => {
  test('offers the four operator-selectable themes', () => {
    expect(Object.keys(ROAD_THEMES)).toEqual(['raptors', 'big-cats', 'weather', 'trees'])
  })

  test('draws names in sequence without colliding case-insensitively', () => {
    expect(nextRoadName('raptors', [])).toBe('FALCON')
    expect(nextRoadName('raptors', ['falcon', 'KESTREL'])).toBe('OSPREY')
  })

  test('every built-in call sign has exactly two spoken syllables by curation', () => {
    for (const theme of Object.values(ROAD_THEMES)) {
      expect(theme.names.length).toBeGreaterThanOrEqual(8)
      expect(theme.names.every((entry) => entry.syllables === 2)).toBe(true)
      expect(new Set(theme.names.map((entry) => entry.name)).size).toBe(theme.names.length)
    }
  })

  test('reports exhaustion rather than reusing a name', () => {
    const used = ROAD_THEMES.trees.names.map((entry) => entry.name)
    expect(nextRoadName('trees', used)).toBeNull()
  })
})
