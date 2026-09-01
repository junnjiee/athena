import type { FastifyInstance } from 'fastify'
import { config } from '../config'
import { RequestBudget } from '../services/sg/budget'
import { FeedRegistry } from '../services/sg/feed'
import { WAVE_ONE_FEEDS, KEYLESS_FEED_IDS } from '../services/sg/sources'

/**
 * Singapore open-data plane.
 *
 * The browser talks only to this service, never to data.gov.sg or DataMall
 * directly, for three reasons: the DataMall key is a server-side secret, the
 * 6-request/10-second keyless ceiling has to be governed centrally rather than
 * per-tab, and every response has to carry provenance the map can render as an
 * age chip. One registry, one budget, one envelope shape for every feed.
 */

export function buildSgRegistry(): FeedRegistry {
  const budget = new RequestBudget(config.sgRequestLimit, config.sgRequestWindowMs)
  const registry = new FeedRegistry({ budget, maxStaleMs: config.sgMaxStaleMs })
  for (const feed of WAVE_ONE_FEEDS) registry.register(feed)
  return registry
}

export function registerSgRoutes(app: FastifyInstance, registry = buildSgRegistry()): void {
  /** What this deployment can serve, and what it is missing a key for. */
  app.get('/api/sg/feeds', async () => ({
    feeds: registry.ids(),
    keyless: KEYLESS_FEED_IDS,
    ltaConfigured: config.ltaAccountKey !== '',
    requestBudget: { limit: config.sgRequestLimit, windowMs: config.sgRequestWindowMs },
  }))

  /**
   * One feed, with provenance. Always 200 when the feed exists — an upstream
   * outage is reported in `provenance.state`, not as an HTTP error, because the
   * client still needs the attribution and the age of whatever it last had.
   */
  app.get<{ Params: { feed: string } }>('/api/sg/:feed', async (request, reply) => {
    const { feed } = request.params
    if (!registry.has(feed)) {
      return reply.status(404).send({ error: `unknown feed: ${feed}` })
    }
    try {
      return await registry.get(feed)
    } catch (error: unknown) {
      app.log.error({ error, feed }, 'singapore feed failed')
      return reply.status(502).send({ error: `feed ${feed} could not be served` })
    }
  })
}
