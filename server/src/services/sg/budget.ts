/**
 * Sliding-window request budget, one per upstream host.
 *
 * data.gov.sg enforces 6 requests / 10 s without a key (12 with a dev key, 30
 * with a production key), and that ceiling — not bandwidth or latency — is what
 * sizes this whole service. Roughly a dozen Singapore feeds on cadences from
 * 20 s to hourly will drift into phase alignment sooner or later, and when a
 * dozen TTLs expire in the same tick a naive fetcher fires a dozen requests at
 * once and earns a 429 for the ones it cares about most.
 *
 * So refreshes queue rather than fail: `acquire()` waits for a slot instead of
 * rejecting. A feed refresh is never urgent to the millisecond — the cache
 * still has the previous value and reports its own age — so delaying a refresh
 * is strictly better than being throttled out of one.
 */
export class RequestBudget {
  /** Completion-ordered timestamps of the requests still inside the window. */
  private hits: number[] = []

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (limit < 1) throw new Error('budget limit must be at least 1')
    if (windowMs < 1) throw new Error('budget window must be positive')
  }

  private prune(at: number): void {
    if (this.hits.length === 0) return
    const cutoff = at - this.windowMs
    let first = 0
    while (first < this.hits.length && this.hits[first]! <= cutoff) first++
    if (first > 0) this.hits = this.hits.slice(first)
  }

  /** Takes a slot if one is free. Never blocks. */
  tryAcquire(): boolean {
    const at = this.now()
    this.prune(at)
    if (this.hits.length >= this.limit) return false
    this.hits.push(at)
    return true
  }

  /** Milliseconds until the next slot frees; 0 when one is free right now. */
  retryAfterMs(): number {
    const at = this.now()
    this.prune(at)
    if (this.hits.length < this.limit) return 0
    // The oldest in-window hit is the one whose expiry frees the next slot.
    return Math.max(1, this.hits[0]! + this.windowMs - at)
  }

  /** Slots currently free in the window. */
  get available(): number {
    this.prune(this.now())
    return Math.max(0, this.limit - this.hits.length)
  }

  /**
   * Waits for a slot and takes it. `sleep` is injectable so tests drive the
   * queueing behaviour without real timers.
   */
  async acquire(sleep: (ms: number) => Promise<void> = defaultSleep): Promise<void> {
    // A loop rather than a single wait: several callers can be waiting on the
    // same slot, and only one of them wins the retry.
    for (;;) {
      if (this.tryAcquire()) return
      await sleep(this.retryAfterMs())
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
