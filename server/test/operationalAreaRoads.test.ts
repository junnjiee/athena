import { describe, expect, test } from 'bun:test'
import { roadSettingsBody } from '../src/routes/operationalAreas'

describe('operational road settings', () => {
  test('accepts an AO theme and sparse edits keyed by road identity', () => {
    expect(
      roadSettingsBody.parse({
        roadTheme: 'weather',
        roadEdits: {
          '123': { name: 'THUNDER', width: 6, dual: true, type: 'X' },
        },
      }),
    ).toEqual({
      roadTheme: 'weather',
      roadEdits: {
        '123': { name: 'THUNDER', width: 6, dual: true, type: 'X' },
      },
    })
  })

  test('rejects values outside the confirmed road grammar', () => {
    expect(roadSettingsBody.safeParse({ roadTheme: 'rivers' }).success).toBe(false)
    expect(
      roadSettingsBody.safeParse({
        roadEdits: { '123': { name: 'FALCON', width: 8, dual: false, type: 'Q' } },
      }).success,
    ).toBe(false)
  })

  test('requires at least one setting to change', () => {
    expect(roadSettingsBody.safeParse({}).success).toBe(false)
  })
})
