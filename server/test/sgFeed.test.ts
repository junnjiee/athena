import { describe, expect, test } from 'bun:test'
import { FeedRegistry, type FeedDefinition } from '../src/services/sg/feed'

function clock(start = 1_700_000_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

/** A fetch stand-in that counts calls and can be told to start failing. */
function stubFetch(payloads: unknown[]) {
  let calls = 0
  let fail = false
  const impl = (async () => {
    if (fail) throw new Error('network down')
    const body = payloads[Math.min(calls, payloads.length - 1)]
    calls++
    return { ok: true, json: async () => body } as unknown as Response
  }) as unknown as typeof fetch
  return {
    impl,
    get calls() { return calls },
    setFail(v: boolean) { fail = v },
  }
}

function counterFeed(overrides: Partial<FeedDefinition<{ n: number }>> = {}): FeedDefinition<{ n: number }> {
  return {
    id: 'counter',
    url: 'https://example.test/counter',
    ttlMs: 60_000,
    attribution: 'Test Agency',
    license: 'Singapore Open Data Licence',
    parse: (raw: unknown) => ({ data: raw as { n: number }, upstreamAt: '2026-08-29T19:00:00+08:00' }),
    ...overrides,
  }
}

describe('FeedRegistry', () => {
  test('serves a fetched value as live, with full provenance', async () => {
    const c = clock()
    const fetcher = stubFetch([{ n: 1 }])
    const registry = new FeedRegistry({ fetchImpl: fetcher.impl, now: c.now })
    registry.register(counterFeed())

    const result = await registry.get('counter')
    expect(result.data).toEqual({ n: 1 })
    expect(result.provenance.state).toBe('live')
    expect(result.provenance.source).toBe('counter')
    expect(result.provenance.attribution).toBe('Test Agency')
    expect(result.provenance.license).toBe('Singapore Open Data Licence')
    expect(result.provenance.upstreamAt).toBe('2026-08-29T19:00:00+08:00')
    expect(result.provenance.ageMs).toBe(0)
    expect(result.provenance.cadenceMs).toBe(60_000)
    expect(result.provenance.note).toBeNull()
  })

  test('serves from cache inside the TTL without re-fetching', async () => {
    const c = clock()
    const fetcher = stubFetch([{ n: 1 }, { n: 2 }])
    const registry = new FeedRegistry({ fetchImpl: fetcher.impl, now: c.now })
    registry.register(counterFeed())

    await registry.get('counter')
    c.advance(30_000)
    const second = await registry.get('counter')

    expect(fetcher.calls).toBe(1)
    expect(second.data).toEqual({ n: 1 })
    expect(second.provenance.state).toBe('cached')
    expect(second.provenance.ageMs).toBe(30_000)
  })

  test('refreshes once the TTL has passed', async () => {
    const c = clock()
    const fetcher = stubFetch([{ n: 1 }, { n: 2 }])
    const registry = new FeedRegistry({ fetchImpl: fetcher.impl, now: c.now })
    registry.register(counterFeed())

    await registry.get('counter')
    c.advance(61_000)
    const second = await registry.get('counter')

    expect(fetcher.calls).toBe(2)
    expect(second.data).toEqual({ n: 2 })
    expect(second.provenance.state).toBe('live')
  })

  test('coalesces concurrent cold-cache reads into one upstream request', async () => {
    const fetcher = stubFetch([{ n: 1 }])
    const registry = new FeedRegistry({ fetchImpl: fetcher.impl, now: clock().now })
    registry.register(counterFeed())

    const results = await Promise.all([
      registry.get('counter'),
      registry.get('counter'),
      registry.get('counter'),
    ])

    expect(fetcher.calls).toBe(1)
    for (const result of results) expect(result.data).toEqual({ n: 1 })
  })

  test('keeps serving the last good value as stale when refresh fails', async () => {
    const c = clock()
    const fetcher = stubFetch([{ n: 1 }])
    const registry = new FeedRegistry({ fetchImpl: fetcher.impl, now: c.now, onWarn: () => {} })
    registry.register(counterFeed())

    await registry.get('counter')
    fetcher.setFail(true)
    c.advance(61_000)
    const result = await registry.get('counter')

    expect(result.data).toEqual({ n: 1 })
    expect(result.provenance.state).toBe('stale')
    expect(result.provenance.ageMs).toBe(61_000)
  })

  test('gives up on a value older than maxStale rather than passing it off', async () => {
    const c = clock()
    const fetcher = stubFetch([{ n: 1 }])
    const registry = new FeedRegistry({
      fetchImpl: fetcher.impl,
      now: c.now,
      maxStaleMs: 5 * 60_000,
      onWarn: () => {},
    })
    registry.register(counterFeed())

    await registry.get('counter')
    fetcher.setFail(true)
    c.advance(10 * 60_000)
    const result = await registry.get('counter')

    expect(result.data).toBeNull()
    expect(result.provenance.state).toBe('unavailable')
  })

  test('marks a structurally valid but incomplete payload degraded, and says why', async () => {
    const fetcher = stubFetch([{ n: 3 }])
    const registry = new FeedRegistry({ fetchImpl: fetcher.impl, now: clock().now })
    registry.register(
      counterFeed({ assess: (data) => (data.n < 10 ? `only ${data.n} of 10 expected` : null) }),
    )

    const result = await registry.get('counter')
    // Degraded outranks freshness: the operator needs to know the payload is
    // thin more than they need to know it arrived a moment ago.
    expect(result.provenance.state).toBe('degraded')
    expect(result.provenance.note).toBe('only 3 of 10 expected')
    // ...and the age is still reported, so nothing is hidden by the precedence.
    expect(result.provenance.ageMs).toBe(0)
    expect(result.data).toEqual({ n: 3 })
  })

  test('reports a missing credential as unavailable with an actionable hint', async () => {
    const fetcher = stubFetch([{ n: 1 }])
    const registry = new FeedRegistry({ fetchImpl: fetcher.impl, now: clock().now })
    registry.register(
      counterFeed({
        requires: { key: 'LTA_ACCOUNT_KEY', value: undefined, hint: 'request a free key' },
      }),
    )

    const result = await registry.get('counter')
    expect(fetcher.calls).toBe(0)
    expect(result.data).toBeNull()
    expect(result.provenance.state).toBe('unavailable')
    expect(result.provenance.note).toContain('LTA_ACCOUNT_KEY')
    expect(result.provenance.note).toContain('request a free key')
  })

  test('a parse failure is a failed fetch, not a poisoned cache', async () => {
    const c = clock()
    const fetcher = stubFetch([{ n: 1 }, { bad: true }])
    const registry = new FeedRegistry({ fetchImpl: fetcher.impl, now: c.now, onWarn: () => {} })
    registry.register(
      counterFeed({
        parse: (raw: unknown) => {
          const r = raw as Record<string, unknown>
          if (typeof r.n !== 'number') throw new Error('missing n')
          return { data: { n: r.n }, upstreamAt: null }
        },
      }),
    )

    await registry.get('counter')
    c.advance(61_000)
    const result = await registry.get('counter')

    expect(result.data).toEqual({ n: 1 })
    expect(result.provenance.state).toBe('stale')
  })

  test('rejects duplicate feed ids and unknown lookups', async () => {
    const registry = new FeedRegistry({ fetchImpl: stubFetch([{}]).impl })
    registry.register(counterFeed())
    expect(() => registry.register(counterFeed())).toThrow(/duplicate/)
    await expect(registry.get('nope')).rejects.toThrow(/unknown/)
  })
})
