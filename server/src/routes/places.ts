import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../config'
import { lookupPlace } from '../services/placeLookup'

export const placeLookupQuery = z.object({
  longitude: z.coerce.number().gte(-180).lte(180),
  latitude: z.coerce.number().gte(-85).lte(85),
  radiusMeters: z.coerce.number().int().min(500).max(50_000).default(10_000),
})

export function registerPlaceRoutes(app: FastifyInstance): void {
  app.get(
    '/api/places/nearest',
    {
      config: {
        rateLimit: {
          max: config.battlegroundRateLimit,
          timeWindow: config.battlegroundRateWindowMs,
        },
      },
    },
    async (req, reply) => {
      const parsed = placeLookupQuery.safeParse(req.query)
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid query' })
      }
      try {
        const { longitude, latitude, radiusMeters } = parsed.data
        return { place: await lookupPlace(longitude, latitude, radiusMeters) }
      } catch (error: unknown) {
        req.log.warn(error, 'place lookup failed')
        return reply.status(502).send({ error: 'place lookup unavailable' })
      }
    },
  )
}
