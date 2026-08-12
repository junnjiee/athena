/**
 * Simulation results as the terrain service delivers them.
 *
 * Runs arrive already scored: the service fetches each replay and reduces it
 * before forwarding the event, because a replay repeats the whole battlefield
 * surface and runs to tens of megabytes. The reduction itself lives in
 * `server/src/services/replaySummary.ts`; `RunResult` below mirrors its output.
 * Only the aggregate across runs is computed here.
 */

/**
 * Who was left standing.
 *
 * The engine stops a run at its tick limit or when one side has no living
 * soldiers, so "inconclusive" means the clock ran out with both sides alive —
 * not a modelling failure. Mutual destruction lands there too: nobody took the
 * ground.
 */
export type Outcome = 'blue' | 'red' | 'inconclusive'

export interface RunResult {
  outcome: Outcome
  /** completed ticks — step 0 is the initial laydown, not a tick */
  ticks: number
  blueAlive: number
  redAlive: number
  blueLosses: number
  redLosses: number
  shotsFired: number
  hits: number
}

export interface BatchOutcome {
  runs: number
  blueWins: number
  redWins: number
  inconclusive: number
  /** 0–1; the headline number — how often this plan works */
  blueWinRate: number
  meanBlueLosses: number
  meanRedLosses: number
  meanTicks: number
}

const mean = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length

/** Aggregate every scored run into the Monte Carlo answer. */
export function summarizeBatch(results: readonly RunResult[]): BatchOutcome {
  const blueWins = results.filter((r) => r.outcome === 'blue').length
  const redWins = results.filter((r) => r.outcome === 'red').length

  return {
    runs: results.length,
    blueWins,
    redWins,
    inconclusive: results.length - blueWins - redWins,
    blueWinRate: results.length === 0 ? 0 : blueWins / results.length,
    meanBlueLosses: mean(results.map((r) => r.blueLosses)),
    meanRedLosses: mean(results.map((r) => r.redLosses)),
    meanTicks: mean(results.map((r) => r.ticks)),
  }
}
