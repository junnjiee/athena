import type { RunResult } from '../types/replay'

/**
 * Reads a simulation batch's server-sent events.
 *
 * The stream comes from this app's own origin — the terrain service pipes the
 * engine's stream through, holding the engine's bearer token so the browser
 * never sees it.
 *
 * Each completed run arrives already scored. The terrain service fetches the
 * replay and reduces it before forwarding the event, because a replay repeats
 * the whole battlefield surface and is tens of megabytes; summarising here
 * meant a 100-run batch moved a gigabyte to the browser to produce one win
 * rate. `replayPath` is kept for a future replay viewer to fetch on demand.
 *
 * Because nothing is fetched here, a result cannot arrive after the batch ends
 * — which is what an earlier version of this module got wrong.
 */

export interface SimulationCompleted {
  simulationId: string
  simulationIndex: number
  /** null when the run finished but its replay could not be read */
  summary: RunResult | null
  summaryError?: string
  /** proxied path to the full replay, for on-demand fetching */
  replayPath: string
}

/** Where a run in flight has got to. Emitted about once a second per run, plus
 *  its first and last tick, so a wait that lasts minutes is legible instead of
 *  indistinguishable from a hang. */
export interface SimulationProgress {
  simulationId: string
  simulationIndex: number
  tick: number
  ticks: number
  blueAlive: number
  redAlive: number
  modelCalls: number
  shotsFired: number
  /** Someone is shooting this tick. */
  inContact: boolean
  /** Commanders that spent a model call this tick. */
  decisions: number
  /** Which commanders are being asked, so the operator sees the simulation
   *  rather than a status light. */
  deciding: Array<{ soldier: number; section: string; side: 'blue' | 'red' }>
  /** Soldiers executing a standing order this tick instead of deciding. */
  standingOrders: number
  agents: number
  followers: number
  /** Wall time the last tick took, which is where a run's minutes go. */
  tickMs: number
  totalCalls: number
}

export interface SimulationFailed {
  simulationId: string
  simulationIndex: number
  error: string
}

export interface BatchCompleted {
  status: string
  completed: number
  failed: number
}

export interface SimulationStreamHandlers {
  /** One finished, scored run. */
  onResult: (result: RunResult, event: SimulationCompleted) => void
  onProgress: (event: SimulationProgress) => void
  onFailed: (event: SimulationFailed) => void
  onDone: (event: BatchCompleted) => void
  /** Transport trouble, or a run that finished but could not be scored. */
  onError: (message: string) => void
}

function parse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** Subscribes to a batch. Returns an unsubscribe that closes the stream. */
export function subscribeSimulation(
  eventsUrl: string,
  handlers: SimulationStreamHandlers,
): () => void {
  const source = new EventSource(eventsUrl)
  let cancelled = false

  source.addEventListener('simulation.completed', (event) => {
    const data = parse<SimulationCompleted>((event as MessageEvent<string>).data)
    if (!data || cancelled) return
    if (data.summary === null) {
      handlers.onError(
        `run ${data.simulationIndex + 1} finished but could not be scored` +
          (data.summaryError === undefined ? '' : ` (${data.summaryError})`),
      )
      return
    }
    handlers.onResult(data.summary, data)
  })

  source.addEventListener('simulation.progress', (event) => {
    const data = parse<SimulationProgress>((event as MessageEvent<string>).data)
    if (data && !cancelled) handlers.onProgress(data)
  })

  source.addEventListener('simulation.failed', (event) => {
    const data = parse<SimulationFailed>((event as MessageEvent<string>).data)
    if (data && !cancelled) handlers.onFailed(data)
  })

  source.addEventListener('batch.completed', (event) => {
    const data = parse<BatchCompleted>((event as MessageEvent<string>).data)
    source.close()
    if (data && !cancelled) handlers.onDone(data)
  })

  source.onerror = () => {
    // EventSource retries by itself, so this only becomes the operator's problem
    // once the browser has given up and closed the connection for good.
    if (source.readyState === EventSource.CLOSED && !cancelled) {
      handlers.onError('lost the connection to the simulation stream')
    }
  }

  return () => {
    cancelled = true
    source.close()
  }
}
