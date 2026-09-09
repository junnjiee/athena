import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../config'
import { lookupPlace, resolvePlaceName } from '../services/placeLookup'

export const placeLookupQuery = z.object({
  longitude: z.coerce.number().gte(-180).lte(180),
  latitude: z.coerce.number().gte(-85).lte(85),
  radiusMeters: z.coerce.number().int().min(500).max(50_000).default(10_000),
})

export const placeResolveQuery = z.object({
  name: z.string().trim().min(1).max(240),
  west: z.coerce.number().gte(-180).lte(180),
  south: z.coerce.number().gte(-85).lte(85),
  east: z.coerce.number().gte(-180).lte(180),
  north: z.coerce.number().gte(-85).lte(85),
}).refine((value) => value.east > value.west && value.north > value.south, 'invalid bounding box')

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
  app.get(
    '/api/places/resolve',
    { config: { rateLimit: { max: config.battlegroundRateLimit, timeWindow: config.battlegroundRateWindowMs } } },
    async (req, reply) => {
      const parsed = placeResolveQuery.safeParse(req.query)
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid query' })
      const { name, west, south, east, north } = parsed.data
      try {
        return { place: await resolvePlaceName(name, { west, south, east, north }) }
      } catch (error: unknown) {
        req.log.warn(error, 'place name resolution failed')
        return reply.status(502).send({ error: 'place lookup unavailable' })
      }
    },
  )
}
