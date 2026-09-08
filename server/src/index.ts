import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { Server as SocketIOServer } from 'socket.io'
import { config } from './config'
import { registerRoutes } from './routes'
import { registerSplatRoutes } from './routes/splats'
import { registerPlanRoutes } from './routes/plans'
import { registerAssistantRoutes } from './routes/assistant'
import { registerOperationalAreaRoutes } from './routes/operationalAreas'
import { registerRouteStudyRoutes } from './routes/routeStudies'
import { getJob } from './services/pipeline'
import type { ProgressEvent } from './types'

const app = Fastify({ logger: { level: 'info' } })

await app.register(cors, { origin: config.corsOrigin })

// Registered globally but opted into per route: only battleground generation
// spends someone else's API quota, so only it carries a cap.
await app.register(rateLimit, { global: false })

const io = new SocketIOServer(app.server, {
  cors: { origin: config.corsOrigin },
  serveClient: false,
})

function emitProgress(jobId: string, event: ProgressEvent): void {
  io.to(`bg:${jobId}`).emit('bg:progress', { jobId, event })
  const job = getJob(jobId)
  if (job && (job.status === 'ready' || job.status === 'error')) {
    const isFinal = event.step === 'grid' && event.status !== 'start'
    if (isFinal) io.to(`bg:${jobId}`).emit('bg:done', { jobId, status: job.status, error: job.error })
  }
}

io.on('connection', (socket) => {
  socket.on('bg:subscribe', (jobId: unknown) => {
    if (typeof jobId !== 'string') return
    const job = getJob(jobId)
    if (!job) {
      socket.emit('bg:error', { jobId, error: 'unknown battleground' })
      return
    }
    void socket.join(`bg:${jobId}`)
    // Late subscribers replay everything emitted so far, then get live events.
    socket.emit('bg:snapshot', { jobId, status: job.status, progress: job.progress, error: job.error })
    if (job.status !== 'running') {
      socket.emit('bg:done', { jobId, status: job.status, error: job.error })
    }
  })
  socket.on('bg:unsubscribe', (jobId: unknown) => {
    if (typeof jobId === 'string') void socket.leave(`bg:${jobId}`)
  })
})

registerRoutes(app, emitProgress)
await registerSplatRoutes(app)
registerPlanRoutes(app)
registerAssistantRoutes(app)
registerOperationalAreaRoutes(app, emitProgress)
registerRouteStudyRoutes(app)

try {
  await app.listen({ port: config.port, host: config.host })
  app.log.info(`ATHENA terrain service on http://${config.host}:${config.port}`)
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
