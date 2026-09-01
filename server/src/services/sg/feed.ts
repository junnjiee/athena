import { RequestBudget } from './budget'

/**
 * Cached, quota-governed, provenance-stamped access to a Singapore open-data feed.
 *
 * Three rules the rest of the service depends on:
 *
 * 1. **The server owns polling.** A browser layer asks this registry for a
 *    value; it never reaches upstream itself. Upstream request rate is then
 *    bounded by (number of feeds ÷ their TTLs) no matter how many operators
 *    have the console open.
 * 2. **Concurrent asks coalesce.** Ten clients arriving on a cold cache produce
 *    one upstream request, not ten.
 * 3. **Nothing fails silently.** Every response carries where it came from, how
 *    old it is, and whether the feed is healthy — because a stale or thinned
 *    feed that looks normal is worse than one that is plainly broken.
 */

export type FeedState = 'live' | 'cached' | 'stale' | 'degraded' | 'unavailable'

export interface Provenance {
  /** Feed id, e.g. `traffic-images`. */
  source: string
  /** Human-readable upstream owner, for the attribution lightbox. */
  attribution: string
  license: string
  /** When this service last successfully fetched, ISO-8601. Null if never. */
  fetchedAt: string | null
  /** The timestamp the upstream payload claims for itself, when it carries one. */
  upstreamAt: string | null
  /** Age of the data this response carries. Null when there is no data. */
  ageMs: number | null
  /** Cadence this feed is expected to refresh at — lets the UI size its age chip. */
  cadenceMs: number
  state: FeedState
  /** Why the feed is degraded, when it is. Rendered verbatim in the banner. */
  note: string | null
}

export interface FeedEnvelope<T> {
  data: T | null
  provenance: Provenance
}

export interface FeedDefinition<T> {
  id: string
  /** Absolute upstream URL, or a builder for feeds that take query parameters. */
  url: string | (() => string)
  /** How long a fetched value is served before a refresh is attempted. */
  ttlMs: number
  attribution: string
  license: string
  timeoutMs?: number
  headers?: Record<string, string>
  /** Set when the feed needs credentials we may not have; the feed then reports
   *  `unavailable` with an actionable note rather than failing at fetch time. */
  requires?: { key: string; value: string | undefined; hint: string }
  /** Normalizes the upstream body. Throwing here is treated as a failed fetch. */
  parse: (raw: unknown) => { data: T; upstreamAt: string | null }
  /**
   * Optional health check for payloads that are structurally valid but
   * materially incomplete. Return a note to mark the feed degraded, or null.
   * This is the only defence against an upstream that serves a thinned payload
   * behind a "healthy" status — which is exactly what LTA's camera feed does.
   */
  assess?: (data: T) => string | null
}

interface CacheEntry<T> {
  data: T
  fetchedAtMs: number
  upstreamAt: string | null
  note: string | null
}

/** Serve a value this far past its TTL when refresh is failing, then give up. */
const DEFAULT_MAX_STALE_MS = 30 * 60_000

/** The only shape of `fetch` this registry needs. Narrower than the global
 *  type on purpose: it keeps the test stubs honest and avoids depending on
 *  runtime-specific extras hanging off `typeof fetch`. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface FeedRegistryOptions {
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: FetchLike
  now?: () => number
  /** Shared per-host quota governor. */
  budget?: RequestBudget
  maxStaleMs?: number
  sleep?: (ms: number) => Promise<void>
  onWarn?: (message: string, detail?: unknown) => void
}

export class FeedRegistry {
  private readonly definitions = new Map<string, FeedDefinition<unknown>>()
  private readonly cache = new Map<string, CacheEntry<unknown>>()
  private readonly inflight = new Map<string, Promise<void>>()

  private readonly fetchImpl: FetchLike
  private readonly now: () => number
  private readonly budget: RequestBudget | null
  private readonly maxStaleMs: number
  private readonly sleep: ((ms: number) => Promise<void>) | undefined
  private readonly onWarn: (message: string, detail?: unknown) => void

  constructor(options: FeedRegistryOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
    this.now = options.now ?? Date.now
    this.budget = options.budget ?? null
    this.maxStaleMs = options.maxStaleMs ?? DEFAULT_MAX_STALE_MS
    this.sleep = options.sleep
    this.onWarn = options.onWarn ?? ((message, detail) => console.warn(`[sg] ${message}`, detail ?? ''))
  }

  register<T>(definition: FeedDefinition<T>): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(`duplicate Singapore feed id: ${definition.id}`)
    }
    this.definitions.set(definition.id, definition as FeedDefinition<unknown>)
  }

  ids(): string[] {
    return [...this.definitions.keys()]
  }

  has(id: string): boolean {
    return this.definitions.has(id)
  }

  /**
   * Returns the feed's current value with provenance. Refreshes when the cached
   * value has aged past its TTL; on refresh failure keeps serving the previous
   * value, marked `stale`, until `maxStaleMs`.
   */
  async get(id: string): Promise<FeedEnvelope<unknown>> {
    const definition = this.definitions.get(id)
    if (!definition) throw new Error(`unknown Singapore feed: ${id}`)

    const missing = definition.requires && !definition.requires.value ? definition.requires : null
    if (missing) {
      return {
        data: null,
        provenance: this.provenance(definition, null, 'unavailable', `${missing.key} is not set — ${missing.hint}`),
      }
    }

    const cached = this.cache.get(id) as CacheEntry<unknown> | undefined
    const fresh = cached !== undefined && this.now() - cached.fetchedAtMs < definition.ttlMs
    if (fresh) return this.envelope(definition, cached, 'cached')

    const before = cached
    await this.refresh(id, definition)
    const after = this.cache.get(id) as CacheEntry<unknown> | undefined

    if (after && after !== before) return this.envelope(definition, after, 'live')

    if (after) {
      const age = this.now() - after.fetchedAtMs
      if (age <= this.maxStaleMs) return this.envelope(definition, after, 'stale')
    }
    return {
      data: null,
      provenance: this.provenance(definition, after ?? null, 'unavailable', 'upstream unreachable and no usable cached value'),
    }
  }

  /** Coalesces concurrent refreshes of the same feed into one upstream request. */
  private refresh(id: string, definition: FeedDefinition<unknown>): Promise<void> {
    const existing = this.inflight.get(id)
    if (existing) return existing

    const run = this.fetchOnce(definition)
      .catch((error: unknown) => {
        this.onWarn(`${id} refresh failed`, error instanceof Error ? error.message : error)
      })
      .finally(() => {
        this.inflight.delete(id)
      })

    this.inflight.set(id, run)
    return run
  }

  private async fetchOnce(definition: FeedDefinition<unknown>): Promise<void> {
    if (this.budget) await this.budget.acquire(this.sleep)

    const url = typeof definition.url === 'function' ? definition.url() : definition.url
    const response = await this.fetchImpl(url, {
      headers: definition.headers,
      signal: AbortSignal.timeout(definition.timeoutMs ?? 12_000),
    })
    if (!response.ok) throw new Error(`${definition.id} HTTP ${response.status}`)

    const body: unknown = await response.json()
    const { data, upstreamAt } = definition.parse(body)
    const note = definition.assess ? definition.assess(data) : null

    this.cache.set(definition.id, { data, fetchedAtMs: this.now(), upstreamAt, note })
  }

  private envelope(
    definition: FeedDefinition<unknown>,
    entry: CacheEntry<unknown>,
    freshness: Extract<FeedState, 'live' | 'cached' | 'stale'>,
  ): FeedEnvelope<unknown> {
    // A degraded payload is the more actionable signal, so it wins over
    // freshness in `state`; `ageMs` still reports how current the data is, so
    // nothing is hidden by the precedence.
    const state: FeedState = entry.note ? 'degraded' : freshness
    return { data: entry.data, provenance: this.provenance(definition, entry, state, entry.note) }
  }

  private provenance(
    definition: FeedDefinition<unknown>,
    entry: CacheEntry<unknown> | null,
    state: FeedState,
    note: string | null,
  ): Provenance {
    return {
      source: definition.id,
      attribution: definition.attribution,
      license: definition.license,
      fetchedAt: entry ? new Date(entry.fetchedAtMs).toISOString() : null,
      upstreamAt: entry?.upstreamAt ?? null,
      ageMs: entry ? this.now() - entry.fetchedAtMs : null,
      cadenceMs: definition.ttlMs,
      state,
      note,
    }
  }
}
