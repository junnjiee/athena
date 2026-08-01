import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/** Gaussian-splat hero assets live here: one directory per asset containing a
 *  tileset.json + SPZ/glb tiles (see assets/splats/README.md and
 *  scripts/wrap-splat.ts). These are OUR licensed captures -- unlike Google's
 *  photoreal tiles they may be cached persistently, so files are served
 *  immutable with Range support (Cesium resumes partial tile fetches). */
export const SPLATS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/splats')

const placementSchema = z.object({
  lon: z.number().gte(-180).lte(180),
  lat: z.number().gte(-90).lte(90),
  heightM: z.number(),
  headingDeg: z.number().optional(),
  scale: z.number().positive().optional(),
})

const splatEntrySchema = z
  .object({
    name: z.string().min(1).max(80),
    ionAssetId: z.number().int().positive().optional(),
    path: z.string().min(1).optional(),
    placement: placementSchema.optional(),
  })
  .refine((e) => e.ionAssetId !== undefined || e.path !== undefined, {
    message: 'splat entry needs an ionAssetId or a path',
  })

export async function registerSplatRoutes(app: FastifyInstance): Promise<void> {
  await fs.mkdir(SPLATS_ROOT, { recursive: true })

  app.get('/api/splats/index', async () => {
    let raw: string
    try {
      raw = await fs.readFile(path.join(SPLATS_ROOT, 'index.json'), 'utf8')
    } catch {
      // no index file = no hero assets configured; Photo mode degrades cleanly
      return []
    }
    try {
      const parsed = z.array(splatEntrySchema).safeParse(JSON.parse(raw))
      if (!parsed.success) {
        app.log.warn({ issues: parsed.error.issues }, 'assets/splats/index.json failed validation; serving no splats')
        return []
      }
      return parsed.data
    } catch (error) {
      app.log.warn({ error }, 'assets/splats/index.json is not valid JSON; serving no splats')
      return []
    }
  })

  await app.register(fastifyStatic, {
    root: SPLATS_ROOT,
    prefix: '/api/splats/files/',
    maxAge: '365d',
    immutable: true,
    // etag, lastModified, and byte-range support are on by default
  })
}
