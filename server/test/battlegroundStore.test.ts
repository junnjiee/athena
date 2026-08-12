import { describe, expect, mock, test } from 'bun:test'
import type { BattlegroundJob } from '../src/types'

/**
 * Terrain must be durable the moment it exists.
 *
 * Saving a plan used to require the battleground still being in the pipeline's
 * in-memory LRU, so a restart — or 24 more grounds — made saving fail with
 * "re-run terrain generation". Since simulating requires a saved plan, that
 * silently blocked simulation too.
 */

const inserted: unknown[] = []
let selectRows: unknown[] = []

mock.module('../src/db/client', () => ({
  db: {
    insert: () => ({
      values: (row: unknown) => ({
        onConflictDoNothing: async () => {
          inserted.push(row)
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectRows,
        }),
      }),
    }),
  },
}))

const { loadBattleground, persistBattleground } = await import('../src/services/battlegroundStore')

const meta = {
  id: 'bg-1',
  name: 'Test ground',
  bbox: { west: 0, south: 0, east: 1, north: 1 },
  width: 4,
  height: 4,
  cellMeters: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  weather: null,
  featureCounts: { roads: 1, buildings: 2, areas: 3 },
  segmentation: null,
}

function job(overrides: Partial<BattlegroundJob> = {}): BattlegroundJob {
  return {
    id: 'bg-1',
    status: 'ready',
    progress: [],
    meta,
    gridBuffer: Buffer.from([1, 2, 3]),
    features: { roads: [], buildings: [], areas: [], waterLines: [] },
    ...overrides,
  }
}

describe('persistBattleground', () => {
  test('writes a finished battleground so a later save does not need the job', async () => {
    inserted.length = 0
    await persistBattleground(job())

    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ id: 'bg-1', width: 4, name: 'Test ground' })
  })

  test('ignores a job that is still running or failed', async () => {
    inserted.length = 0
    await persistBattleground(job({ status: 'running', meta: null, gridBuffer: null }))
    await persistBattleground(job({ status: 'error', error: 'boom' }))

    expect(inserted).toHaveLength(0)
  })
})

describe('loadBattleground', () => {
  test('reconstructs the stored terrain', async () => {
    selectRows = [{ ...meta, gridBuffer: Buffer.from([9]), features: { roads: [] } }]

    const stored = await loadBattleground('bg-1')

    expect(stored?.meta.id).toBe('bg-1')
    expect(stored?.meta.cellMeters).toBe(1)
    expect(stored?.gridBuffer).toEqual(Buffer.from([9]))
  })

  test('is null for ground that was never generated', async () => {
    selectRows = []

    expect(await loadBattleground('nope')).toBeNull()
  })
})
