import { describe, expect, test } from 'bun:test'
import { RequestBudget } from '../src/services/sg/budget'

/** Drives the budget off a hand-cranked clock so the window is exercised exactly. */
function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('RequestBudget', () => {
  test('allows exactly `limit` requests inside the window', () => {
    const c = clock()
    const budget = new RequestBudget(6, 10_000, c.now)
    for (let i = 0; i < 6; i++) expect(budget.tryAcquire()).toBe(true)
    expect(budget.tryAcquire()).toBe(false)
    expect(budget.available).toBe(0)
  })

  test('frees a slot once the oldest hit leaves the window', () => {
    const c = clock()
    const budget = new RequestBudget(2, 10_000, c.now)
    budget.tryAcquire()
    c.advance(4_000)
    budget.tryAcquire()
    expect(budget.tryAcquire()).toBe(false)

    // The first hit expires at t+10s, which is 6s after the second was taken.
    expect(budget.retryAfterMs()).toBe(6_000)
    c.advance(6_000)
    expect(budget.tryAcquire()).toBe(true)
  })

  test('retryAfterMs is zero while capacity remains', () => {
    const budget = new RequestBudget(3, 10_000, clock().now)
    budget.tryAcquire()
    expect(budget.retryAfterMs()).toBe(0)
  })

  test('acquire queues rather than failing when the window is full', async () => {
    const c = clock()
    const budget = new RequestBudget(1, 10_000, c.now)
    const waits: number[] = []
    // Injected sleep advances the clock, standing in for real elapsed time.
    const sleep = async (ms: number) => { waits.push(ms); c.advance(ms) }

    await budget.acquire(sleep)
    expect(waits).toEqual([])

    await budget.acquire(sleep)
    expect(waits).toEqual([10_000])
  })

  test('rejects nonsensical configuration', () => {
    expect(() => new RequestBudget(0, 1_000)).toThrow()
    expect(() => new RequestBudget(1, 0)).toThrow()
  })
})
