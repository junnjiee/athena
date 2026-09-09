import type {
  CourseOfAction,
  EnemyIntent,
  Posture,
  RankedCourses,
  RankingWeights,
  RejectedReference,
} from '../types/routeStudy'

/**
 * Presenting an enemy assessment.
 *
 * Everything here is display over the model's judgement, never a correction of
 * it. The scores are opinion on a scale rather than probability, so they are
 * shown as the model's numbers and never rounded into confidence language.
 */

export const POSTURE_LABEL: Record<Posture, string> = {
  attacking: 'Attacking',
  defending: 'Defending',
  delaying: 'Delaying',
  withdrawing: 'Withdrawing',
  unknown: 'Unknown',
}

export const POSTURE_ORDER: Posture[] = [
  'attacking',
  'defending',
  'delaying',
  'withdrawing',
  'unknown',
]

export const WEIGHT_LABEL: Record<keyof RankingWeights, string> = {
  speed: 'Speed',
  blockable: 'Blockability',
  complexity: 'Simplicity',
  likelihood: 'Likelihood',
  danger: 'Danger',
}

export const WEIGHT_HINT: Record<keyof RankingWeights, string> = {
  speed: 'How fast the corridors a course uses are',
  blockable: 'Whether those corridors have a choke point to hold',
  complexity: 'How few separate efforts the course runs',
  likelihood: "The model's own likelihood score",
  danger: "The model's own danger score",
}

export function emptyIntent(): EnemyIntent {
  return { posture: 'unknown', objective_ids: [], narrative: '' }
}

/** With no posture, no named objective and no narrative, the model has nothing
 *  but terrain and what comes back is geography rather than intelligence. The
 *  panel warns rather than refuses, exactly as the engine does. */
export function intentIsEmpty(intent: EnemyIntent): boolean {
  return (
    intent.posture === 'unknown' &&
    intent.objective_ids.length === 0 &&
    intent.narrative.trim() === ''
  )
}

/** Which corridors a course rides on, and how hard. A main effort outranks a
 *  supporting one on shared ground: the heavier claim is the one to draw. */
export function courseEmphasis(course: CourseOfAction | null): Map<string, 'main' | 'supporting'> {
  const emphasis = new Map<string, 'main' | 'supporting'>()
  for (const effort of course?.efforts ?? []) {
    if (effort.kind === 'main' || !emphasis.has(effort.corridor_id)) {
      emphasis.set(effort.corridor_id, effort.kind)
    }
  }
  return emphasis
}

/** The doctrinal pair, which is selected before learned weights are applied
 *  and cannot be learned away. */
export function courseTags(ranked: RankedCourses, course: CourseOfAction): string[] {
  const tags: string[] = []
  if (ranked.most_likely?.name === course.name) tags.push('most likely')
  if (ranked.most_dangerous?.name === course.name) tags.push('most dangerous')
  return tags
}

export function formatScore(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** A rejected reference means the assessment was incomplete — the course named
 *  ground the study does not contain and was dropped. Read before treating the
 *  list as the whole answer. */
export function rejectedSummary(rejected: RejectedReference[]): string[] {
  return rejected.map((entry) => {
    const named = entry.corridor_id ?? entry.reserve_id
    return named
      ? `${entry.course_name} — ${named}: ${entry.reason}`
      : `${entry.course_name}: ${entry.reason}`
  })
}

/** How far one learned weight has drifted from neutral. Named rather than
 *  charted: a ranking nobody can read in words is one nobody should trust. */
export function weightBias(weight: number): 'favours' | 'discounts' | 'neutral' {
  if (weight > 0.55) return 'favours'
  if (weight < 0.45) return 'discounts'
  return 'neutral'
}

export const WEIGHT_KEYS: (keyof RankingWeights)[] = [
  'speed',
  'blockable',
  'complexity',
  'likelihood',
  'danger',
]
