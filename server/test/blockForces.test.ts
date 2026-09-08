import { describe, expect, test } from 'bun:test'
import { blockForcesBody } from '../src/routes/routeStudies'

const unit = (over: Record<string, unknown> = {}) => ({
  unit_id: 'sec1',
  name: '1 Section',
  echelon: 'section',
  lon: 103.8,
  lat: 1.35,
  strength: 7,
  ...over,
})

const body = (over: Record<string, unknown> = {}) => ({
  orbat: { units: [unit()] },
  ceiling: 'platoon',
  ...over,
})

describe('blockForcesBody', () => {
  test('accepts an ORBAT and a ceiling', () => {
    const parsed = blockForcesBody.safeParse(body())

    expect(parsed.success).toBe(true)
  })

  test('defaults a unit to uncommitted', () => {
    const parsed = blockForcesBody.parse(body())

    expect(parsed.orbat.units[0].availability).toBe('uncommitted')
  })

  test('keeps an explicit availability', () => {
    const parsed = blockForcesBody.parse(
      body({ orbat: { units: [unit({ availability: 'committed' })] } }),
    )

    expect(parsed.orbat.units[0].availability).toBe('committed')
  })

  test('rejects an echelon the engine does not model', () => {
    // nothing above a company exists, so a battalion would silently mean nothing
    expect(blockForcesBody.safeParse(body({ ceiling: 'battalion' })).success).toBe(false)
  })

  test('rejects a unit of no men', () => {
    expect(
      blockForcesBody.safeParse(body({ orbat: { units: [unit({ strength: 0 })] } })).success,
    ).toBe(false)
  })

  test('rejects a mark outside the world', () => {
    expect(
      blockForcesBody.safeParse(body({ orbat: { units: [unit({ lon: 999 })] } })).success,
    ).toBe(false)
  })

  test('requires a ceiling rather than assuming one', () => {
    // Assuming a ceiling would quietly commit a larger force than intended.
    const { ceiling: _ceiling, ...withoutCeiling } = body()
    expect(blockForcesBody.safeParse(withoutCeiling).success).toBe(false)
  })

  test('an empty ORBAT is allowed, and answers that nothing can block', () => {
    expect(blockForcesBody.safeParse(body({ orbat: { units: [] } })).success).toBe(true)
  })

  test('accepts a parent link for a subordinate unit', () => {
    const parsed = blockForcesBody.safeParse(
      body({
        orbat: {
          units: [unit({ unit_id: 'pl1', echelon: 'platoon' }), unit({ parent_id: 'pl1' })],
        },
      }),
    )

    expect(parsed.success).toBe(true)
  })
})
