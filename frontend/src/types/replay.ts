/**
 * Simulation results as the terrain service delivers them.
 *
 * Runs arrive already scored — the engine reports a run's outcome on the
 * completion event, so nothing fetches a replay to compute a win rate.
 * `RunResult` mirrors that outcome. Only the aggregate across runs is computed
 * here.
 *
 * `ReplayLog` below is the full run, fetched on demand by the replay viewer.
 * It mirrors replay schema 4 in `engine/athena/models/replay.py`, which drops
 * the per-cell battlefield surface — 92% of a 17 MB file — and keeps the class
 * grid, so a replay still describes its own ground.
 */

export interface ReplayPosition {
  x: number
  y: number
  z: number
}

export interface ReplayShot {
  shooter_index: number
  target_index: number
  shooter_position: ReplayPosition
  target_position: ReplayPosition
  hit: boolean
}

export interface ReplaySoldier {
  soldier_index: number
  team: 'blue' | 'red'
  position: ReplayPosition
  survival_status: 'alive' | 'casualty' | 'dead'
}

/** What one agent did in a tick and why it said it did it. Followers running
 *  the engine's section policy have no intent to report, so they do not appear. */
export interface ReplayDecision {
  soldier_index: number
  action: string
  rationale: string
}

export interface ReplayStep {
  step: number
  soldiers: ReplaySoldier[]
  shots: ReplayShot[]
  /** Absent on replays written before agents reported their reasoning. */
  decisions?: ReplayDecision[]
}

export interface ReplayLog {
  schema_version: number
  battlefield: {
    width: number
    height: number
    /** row-major class grid, one entry per width x height cell */
    terrain_classes: number[]
  }
  steps: ReplayStep[]
}

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
  /** What the run actually spent. Absent on batches run before the engine
   *  reported it. */
  seed?: number
  agents?: number
  followers?: number
  /** Decisions that cost a model call, and decisions served from a standing
   *  order because the commander had nothing new to decide. */
  modelCalls?: number
  standingOrders?: number
  callTicks?: number
  /** Provider round trips — what the wall clock is actually made of. */
  providerRequests?: number
}

export interface BatchOutcome {
  runs: number
  blueWins: number
  redWins: number
  inconclusive: number
  /** 0–1; the headline number — how often this plan works */
  blueWinRate: number
  /** 95% Wilson interval on that rate, 0–1. A Monte Carlo answer without one
   *  cannot say whether 62% and 58% are different plans or the same plan run
   *  twice, which is the question the whole thing exists to answer. */
  blueWinRateLow: number
  blueWinRateHigh: number
  meanBlueLosses: number
  meanRedLosses: number
  meanTicks: number
}

const mean = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length

/**
 * 95% Wilson score interval for a proportion.
 *
 * Wilson rather than the normal approximation because a batch is small and the
 * rate is often near 0 or 1, exactly where the normal approximation produces
 * bounds outside [0, 1] and understates the uncertainty.
 */
export function wilsonInterval(
  successes: number,
  trials: number,
): { low: number; high: number } {
  if (trials === 0) return { low: 0, high: 1 }

  const z = 1.96
  const p = successes / trials
  const denominator = 1 + (z * z) / trials
  const centre = p + (z * z) / (2 * trials)
  const spread = z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials))

  return {
    low: Math.max(0, (centre - spread) / denominator),
    high: Math.min(1, (centre + spread) / denominator),
  }
}

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
    blueWinRateLow: wilsonInterval(blueWins, results.length).low,
    blueWinRateHigh: wilsonInterval(blueWins, results.length).high,
    meanBlueLosses: mean(results.map((r) => r.blueLosses)),
    meanRedLosses: mean(results.map((r) => r.redLosses)),
    meanTicks: mean(results.map((r) => r.ticks)),
  }
}
