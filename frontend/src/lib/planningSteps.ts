/** The route-substrate workflow, as a commander walks it.
 *
 *  The page has always had these eight steps; it just never said so, leaving a
 *  first-time operator staring at a globe with four disabled buttons. Keeping
 *  the sequence here — pure, over a flat snapshot of progress — means the guide
 *  on screen and the panels underneath it can never disagree about where the
 *  work has got to.
 */

export type PlanningStepId =
  | 'area'
  | 'ingest'
  | 'reserves'
  | 'objectives'
  | 'run'
  | 'enemy'
  | 'force'
  | 'block'

export interface PlanningProgress {
  /** A rectangle has been dragged but not yet ingested. */
  hasSelection: boolean
  hasArea: boolean
  reserveCount: number
  objectiveCount: number
  hasStudy: boolean
  /** Marks have moved since the study that is on screen was run. */
  marksDirty: boolean
  hasCourses: boolean
  unitCount: number
  hasBlockPlan: boolean
}

export type PlanningStepStatus = 'done' | 'current' | 'pending'

export interface PlanningStep {
  id: PlanningStepId
  label: string
  /** What to do, in the imperative, addressed to the operator. */
  action: string
  status: PlanningStepStatus
}

const SEQUENCE: { id: PlanningStepId; label: string; action: string }[] = [
  {
    id: 'area',
    label: 'Select ground',
    action: 'Drag a box over the ground the enemy would move through — at least 10 km a side.',
  },
  {
    id: 'ingest',
    label: 'Ingest roads',
    action: 'Name the area and ingest its road graph. This takes a minute or two.',
  },
  {
    id: 'reserves',
    label: 'Mark reserves',
    action: 'Click where you believe enemy reserves are held. Every route starts at one.',
  },
  {
    id: 'objectives',
    label: 'Designate objectives',
    action: 'Drag a box over what the enemy wants. Every route ends at one.',
  },
  {
    id: 'run',
    label: 'Run the study',
    action: 'Run the study to find the corridors between those reserves and those objectives.',
  },
  {
    id: 'enemy',
    label: 'Assess the enemy',
    action: 'On the Enemy tab, state what you think they want, then assess their courses of action.',
  },
  {
    id: 'force',
    label: 'List your force',
    action: 'On the ORBAT tab, place the units you actually have available today.',
  },
  {
    id: 'block',
    label: 'Plan the block',
    action: 'On the Block tab, work out which of your units can hold each corridor.',
  },
]

function isDone(id: PlanningStepId, progress: PlanningProgress): boolean {
  switch (id) {
    case 'area':
      return progress.hasSelection || progress.hasArea
    case 'ingest':
      return progress.hasArea
    case 'reserves':
      return progress.reserveCount > 0
    case 'objectives':
      return progress.objectiveCount > 0
    case 'run':
      return progress.hasStudy && !progress.marksDirty
    case 'enemy':
      return progress.hasCourses
    case 'force':
      return progress.unitCount > 0
    case 'block':
      return progress.hasBlockPlan
  }
}

/** The eight steps with the first unfinished one marked current.
 *
 *  Earlier steps stay `done` even once a later one is reached and something
 *  upstream is undone again — the current step is the first gap, so removing
 *  every reserve from a finished study walks the guide back to reserves rather
 *  than pretending the study still stands. */
export function planningSteps(progress: PlanningProgress): PlanningStep[] {
  const firstGap = SEQUENCE.findIndex((step) => !isDone(step.id, progress))
  return SEQUENCE.map((step, index) => ({
    ...step,
    status: index === firstGap ? 'current' : isDone(step.id, progress) ? 'done' : 'pending',
  }))
}

/** The step the operator is on, or null once all eight are behind them. */
export function currentPlanningStep(progress: PlanningProgress): PlanningStep | null {
  return planningSteps(progress).find((step) => step.status === 'current') ?? null
}
