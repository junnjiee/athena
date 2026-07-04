import { io, type Socket } from 'socket.io-client'
import type { ProgressEvent } from '../types/terrain'

let socket: Socket | null = null

/** Lazy singleton — connects through the Vite proxy on first use. */
function getSocket(): Socket {
  if (!socket) {
    socket = io({ transports: ['websocket'], reconnectionDelay: 500 })
  }
  return socket
}

export interface BattlegroundSubscription {
  onProgress: (event: ProgressEvent) => void
  onDone: (status: 'ready' | 'error', error?: string) => void
  onError: (message: string) => void
}

/** Subscribe to live pipeline progress for a job. Returns an unsubscribe fn.
 *  The server replays missed events on subscribe, so late joins are safe. */
export function subscribeBattleground(jobId: string, handlers: BattlegroundSubscription): () => void {
  const s = getSocket()

  const handleSnapshot = (payload: { jobId: string; progress: ProgressEvent[] }) => {
    if (payload.jobId !== jobId) return
    for (const event of payload.progress) handlers.onProgress(event)
  }
  const handleProgress = (payload: { jobId: string; event: ProgressEvent }) => {
    if (payload.jobId === jobId) handlers.onProgress(payload.event)
  }
  const handleDone = (payload: { jobId: string; status: 'ready' | 'error'; error?: string }) => {
    if (payload.jobId === jobId) handlers.onDone(payload.status, payload.error)
  }
  const handleError = (payload: { jobId: string; error: string }) => {
    if (payload.jobId === jobId) handlers.onError(payload.error)
  }

  s.on('bg:snapshot', handleSnapshot)
  s.on('bg:progress', handleProgress)
  s.on('bg:done', handleDone)
  s.on('bg:error', handleError)
  s.emit('bg:subscribe', jobId)

  return () => {
    s.emit('bg:unsubscribe', jobId)
    s.off('bg:snapshot', handleSnapshot)
    s.off('bg:progress', handleProgress)
    s.off('bg:done', handleDone)
    s.off('bg:error', handleError)
  }
}
