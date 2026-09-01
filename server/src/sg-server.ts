import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from './config'
import { registerSgRoutes } from './routes/sg'

/**
 * Standalone Singapore data plane.
 *
 * The main server imports the Drizzle client at module load, so it needs a
 * database before it will start. The SG plane needs none — it is a cache and a
 * quota governor in front of public HTTP APIs — so it runs on its own here.
 *
 * That is useful beyond convenience: it keeps the SG plane's dependencies
 * honest. If this file ever stops booting, something has coupled the data
 * plane to storage that it should not need.
 *
 *   bun run sg
 */
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })

await app.register(cors, { origin: config.corsOrigin })
registerSgRoutes(app)

const port = Number(process.env.SG_PORT ?? config.port)
try {
  await app.listen({ port, host: config.host })
  app.log.info(`Singapore data plane on http://${config.host}:${port}/api/sg/feeds`)
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
