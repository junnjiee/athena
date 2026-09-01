/**
 * Reduces an engine replay to the handful of numbers a commander asked for.
 *
 * This runs here rather than in the browser because a replay is dominated by
 * `battlefield.surface` — one JSON object per cell, so ~16 MB on an 800×800
 * ground, repeated identically in every run of a batch. Summarising client-side
 * meant a 100-run batch pushed well over a gigabyte to the browser to produce a
 * single win rate.
 *
 * The types mirror replay schema version 3 in `engine/athena/models/replay.py`.
 * Pydantic serialises field names as snake_case and its `StrEnum`s as plain
 * strings, hence the shape below.
 */

export type ReplayTeam = 'blue' | 'red'
export type ReplaySurvivalState = 'alive' | 'casualty' | 'dead'

export interface ReplaySoldier {
  soldier_index: number
  team: ReplayTeam
  survival_status: ReplaySurvivalState
}

export interface ReplayStep {
  step: number
  soldiers: ReplaySoldier[]
  shots: { hit: boolean }[]
}

export interface ReplayLog {
  schema_version: number
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
  /** Reported by the engine: what the run actually spent. */
  seed?: number
  agents?: number
  followers?: number
  modelCalls?: number
  standingOrders?: number
  callTicks?: number
  providerRequests?: number
}

function aliveByTeam(step: ReplayStep | undefined): Record<ReplayTeam, number> {
  const counts: Record<ReplayTeam, number> = { blue: 0, red: 0 }
  for (const soldier of step?.soldiers ?? []) {
    if (soldier.survival_status === 'alive') counts[soldier.team] += 1
  }
  return counts
}

export function summarizeRun(replay: ReplayLog): RunResult {
  const steps = replay.steps ?? []
  const start = aliveByTeam(steps[0])
  const end = aliveByTeam(steps[steps.length - 1])

  const outcome: Outcome =
    end.blue > 0 && end.red === 0 ? 'blue' : end.red > 0 && end.blue === 0 ? 'red' : 'inconclusive'

  let shotsFired = 0
  let hits = 0
  for (const step of steps) {
    for (const shot of step.shots ?? []) {
      shotsFired += 1
      if (shot.hit) hits += 1
    }
  }

  return {
    outcome,
    ticks: Math.max(0, steps.length - 1),
    blueAlive: end.blue,
    redAlive: end.red,
    blueLosses: start.blue - end.blue,
    redLosses: start.red - end.red,
    shotsFired,
    hits,
  }
}
