import type { BatchOutcome, ReplayLog } from '../types/replay'

/**
 * What to change about a plan, derived from what actually happened to it.
 *
 * Deterministic and evidence-backed on purpose. Every recommendation quotes the
 * number that produced it, so an operator can disagree with the reasoning rather
 * than with an oracle — and so a wrong recommendation is a rule to fix rather
 * than a prompt to re-roll. Nothing here calls a model.
 *
 * `fix` is the mechanical change where one exists. The conclusion page turns it
 * into a button; where the fix is a judgement about ground, there is none and
 * the recommendation is advice.
 */

export type RecommendationSeverity = 'critical' | 'warning' | 'note'

export interface Recommendation {
  id: string
  severity: RecommendationSeverity
  title: string
  /** Why this is being said, in the numbers the batch produced. */
  evidence: string
  /** What to do about it. */
  action: string
  /** A change the app can apply itself, when the fix is mechanical. */
  fix?: { kind: 'ticks'; ticks: number } | { kind: 'runs'; runs: number }
}

export interface RecommendationInput {
  outcome: BatchOutcome
  ticks: number
  /** One completed run, for reading what the ground did to the plan. */
  replay: ReplayLog | null
  /** Whether blue could physically reach its objective, when known. */
  objectiveReachable?: boolean
}

const SEVERITY_ORDER: Record<RecommendationSeverity, number> = {
  critical: 0,
  warning: 1,
  note: 2,
}

/** Chebyshev distance, matching the engine's own one-cell-per-step geometry. */
function gap(replay: ReplayLog): number | null {
  const first = replay.steps[0]
  if (!first) return null

  const blue = first.soldiers.filter((s) => s.team === 'blue')
  const red = first.soldiers.filter((s) => s.team === 'red')
  if (blue.length === 0 || red.length === 0) return null

  let closest = Infinity
  for (const b of blue) {
    for (const r of red) {
      const distance = Math.max(
        Math.abs(b.position.x - r.position.x),
        Math.abs(b.position.y - r.position.y),
      )
      if (distance < closest) closest = distance
    }
  }
  return closest
}

/** Ticks a soldier needs to cross a gap at the default movement allowance. */
const CELLS_PER_TICK = 5

export function buildRecommendations({
  outcome,
  ticks,
  replay,
  objectiveReachable,
}: RecommendationInput): Recommendation[] {
  const found: Recommendation[] = []
  if (outcome.runs === 0) return found

  // Nothing else is worth saying if the plan could never have worked.
  if (objectiveReachable === false) {
    return [
      {
        id: 'unreachable',
        severity: 'critical',
        title: 'The objective could not be reached',
        evidence:
          'There is no route from the force to its objective — water or a ' +
          'slope severs the ground between them.',
        action:
          'This plan cannot succeed however long it runs, so the result above ' +
          'says nothing about it. Move the objective to reachable ground, or ' +
          'route the force through a crossing.',
      },
    ]
  }

  const inconclusiveShare = outcome.inconclusive / outcome.runs
  const separation = replay ? gap(replay) : null

  // 1. The clock, not the plan.
  if (inconclusiveShare > 0.5) {
    const needed = separation
      ? Math.ceil((separation / CELLS_PER_TICK) * 2)
      : ticks * 2
    found.push({
      id: 'inconclusive',
      severity: 'critical',
      title: 'Most runs ended before either side could decide it',
      evidence:
        `${outcome.inconclusive} of ${outcome.runs} runs finished with both sides ` +
        `alive` +
        (separation !== null
          ? `, and your forces start ${separation} m apart.`
          : '.'),
      action:
        separation !== null
          ? `At about ${CELLS_PER_TICK} m a tick that gap alone takes ~${Math.ceil(
              separation / CELLS_PER_TICK,
            )} ticks to close. Raise the tick budget or draw the forces closer.`
          : 'Raise the tick budget, or draw the forces closer together.',
      fix: { kind: 'ticks', ticks: Math.max(needed, ticks * 2) },
    })
  }

  // 2. A verdict with no confidence behind it.
  const width = outcome.blueWinRateHigh - outcome.blueWinRateLow
  if (width > 0.3 && outcome.runs < 100) {
    found.push({
      id: 'low-confidence',
      severity: 'warning',
      title: 'Too few runs to trust the win rate',
      evidence:
        `${Math.round(outcome.blueWinRate * 100)}% over ${outcome.runs} run` +
        `${outcome.runs === 1 ? '' : 's'}, but the 95% interval spans ` +
        `${Math.round(outcome.blueWinRateLow * 100)}–${Math.round(
          outcome.blueWinRateHigh * 100,
        )}%.`,
      action:
        'Run more simulations before comparing this plan against another — the ' +
        'difference between them is currently smaller than the error bar.',
      fix: { kind: 'runs', runs: outcome.runs < 10 ? 50 : 100 },
    })
  }

  // 3. Won, but at a price worth noticing.
  if (outcome.blueWinRate >= 0.5 && outcome.meanBlueLosses > outcome.meanRedLosses) {
    found.push({
      id: 'costly-win',
      severity: 'warning',
      title: 'The plan wins but trades badly',
      evidence:
        `Blue loses ${outcome.meanBlueLosses.toFixed(1)} soldiers a run against ` +
        `red's ${outcome.meanRedLosses.toFixed(1)}.`,
      action:
        'Look for an approach with more cover, or shift weight to the flank that ' +
        'is taking fewer casualties.',
    })
  }

  // 4. Losing outright.
  if (outcome.blueWinRate < 0.25 && inconclusiveShare <= 0.5) {
    found.push({
      id: 'losing',
      severity: 'critical',
      title: 'This plan loses',
      evidence:
        `Blue takes the ground in ${outcome.blueWins} of ${outcome.runs} runs, ` +
        `losing ${outcome.meanBlueLosses.toFixed(1)} soldiers a run.`,
      action:
        'Change the approach rather than the numbers: re-route through concealing ' +
        'ground, or commit a second element on another axis so the defence is ' +
        'split.',
    })
  }

  // 5. Everyone dies. A property of the shooting model, not of the plan.
  if (replay) {
    const start = replay.steps[0]?.soldiers.length ?? 0
    const final = replay.steps[replay.steps.length - 1]?.soldiers ?? []
    const alive = final.filter((s) => s.survival_status === 'alive').length
    if (start > 0 && alive / start < 0.3) {
      found.push({
        id: 'attrition',
        severity: 'note',
        title: 'Both sides were destroyed',
        evidence: `${alive} of ${start} soldiers were still standing at the end.`,
        action:
          'Engagements inside 50 m are decided fast: a soldier under fire shoots ' +
          'much less accurately, but one that is not is very likely to hit. Winning ' +
          'this ground cheaply means arriving somewhere the enemy cannot answer ' +
          'from — not more soldiers.',
      })
    }
  }

  return found.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
}
