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
  ...over,
})

describe('blockForcesBody', () => {
  test('accepts an ORBAT without an artificial size ceiling', () => {
    const parsed = blockForcesBody.safeParse(body())

    expect(parsed.success).toBe(true)
  })

  test('defaults a unit to uncommitted', () => {
    const parsed = blockForcesBody.parse(body())

    expect(parsed.orbat.units[0].availability).toBe('uncommitted')
    expect(parsed.orbat.units[0].weapons).toEqual([])
  })

  test('keeps an explicit availability', () => {
    const parsed = blockForcesBody.parse(
      body({ orbat: { units: [unit({ availability: 'committed' })] } }),
    )

    expect(parsed.orbat.units[0].availability).toBe('committed')
  })

  test('accepts REDCON 1 through 5 without confusing it with availability', () => {
    const parsed = blockForcesBody.parse(
      body({ orbat: { units: [unit({ redcon: 4, availability: 'uncommitted' })] } }),
    )

    expect(parsed.orbat.units[0]).toMatchObject({ redcon: 4, availability: 'uncommitted' })
    expect(blockForcesBody.safeParse(
      body({ orbat: { units: [unit({ redcon: 6 })] } }),
    ).success).toBe(false)
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

  test('strips the retired ceiling from older clients', () => {
    const parsed = blockForcesBody.parse(body({ ceiling: 'platoon' }))
    expect(parsed).not.toHaveProperty('ceiling')
    expect(parsed.orbat.units[0].availability).toBe('uncommitted')
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

  test('accepts structured generic weapon holdings and rejects invented systems', () => {
    const parsed = blockForcesBody.parse(body({
      orbat: {
        units: [unit({
          weapons: [
            { id: 'atgm', weapon: 'ATGM', count: 2 },
            { id: 'law', weapon: 'LAW', count: 3 },
          ],
        })],
      },
    }))

    expect(parsed.orbat.units[0].weapons).toEqual([
      { id: 'atgm', weapon: 'ATGM', count: 2 },
      { id: 'law', weapon: 'LAW', count: 3 },
    ])
    expect(blockForcesBody.safeParse(body({
      orbat: { units: [unit({ weapons: [{ id: 'laser', weapon: 'Laser', count: 1 }] })] },
    })).success).toBe(false)
  })

  test('rejects duplicate holdings for one weapon system', () => {
    expect(blockForcesBody.safeParse(body({
      orbat: {
        units: [unit({ weapons: [
          { id: 'law-1', weapon: 'LAW', count: 1 },
          { id: 'law-2', weapon: 'LAW', count: 2 },
        ] })],
      },
    })).success).toBe(false)
  })

  test('accepts bounded unique operator block points', () => {
    const point = { inlet_id: 'inlet-1', lon: 103.8, lat: 1.35 }
    expect(blockForcesBody.parse(body({ blockPoints: [point] })).blockPoints).toEqual([point])
    expect(blockForcesBody.safeParse(body({ blockPoints: [point, point] })).success).toBe(false)
    expect(blockForcesBody.safeParse(body({
      blockPoints: [{ ...point, lon: 999 }],
    })).success).toBe(false)
  })

  test('accepts one bounded positive delay assessment per inlet', () => {
    const assessment = { inlet_id: 'inlet-1', unit_id: 'sec1', delay_minutes: 45 }
    expect(blockForcesBody.parse(body({ delayAssessments: [assessment] })).delayAssessments)
      .toEqual([assessment])
    expect(blockForcesBody.safeParse(body({
      delayAssessments: [assessment, assessment],
    })).success).toBe(false)
    expect(blockForcesBody.safeParse(body({
      delayAssessments: [{ ...assessment, delay_minutes: 0 }],
    })).success).toBe(false)
    expect(blockForcesBody.safeParse(body({
      delayAssessments: [{ ...assessment, delay_minutes: 10_081 }],
    })).success).toBe(false)
  })
})
