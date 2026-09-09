import { AlertTriangle, Brain, Loader2, ThumbsDown, ThumbsUp } from 'lucide-react'
import { corridorColor, corridorLabel } from '../../lib/corridors'
import {
  courseTags,
  formatScore,
  intentIsEmpty,
  rejectedSummary,
} from '../../lib/courses'
import type {
  CourseOfAction,
  EnemyIntent,
  Preferences,
  RouteStudy,
  Verdict,
} from '../../types/routeStudy'

interface Props {
  study: RouteStudy
  intent: EnemyIntent
  running: boolean
  selectedCourseName: string | null
  preferences: Preferences | null
  onSetIntent: (patch: Partial<EnemyIntent>) => void
  onToggleObjective: (objectiveId: string) => void
  onSelectCourse: (name: string | null) => void
  onAssess: () => void
  onJudge: (courseName: string, verdict: Verdict) => void
}

/**
 * The S2 pass: how this enemy would use the corridors already found.
 *
 * The one screen in the app whose answer comes from a model, and it says so.
 * Two runs over identical ground may name different courses, so an assessment
 * worth defending later is recorded rather than regenerated.
 */
export function EnemyCoursesPanel({
  study,
  intent,
  running,
  selectedCourseName,
  preferences,
  onSetIntent,
  onToggleObjective,
  onSelectCourse,
  onAssess,
  onJudge,
}: Props) {
  const ranked = study.courses
  const corridorNames = new Map(
    study.result.corridors.map((corridor, index) => [
      corridor.id,
      { label: corridorLabel(corridor, index, study.corridorEdits), color: corridorColor(index) },
    ]),
  )
  const reserveNames = new Map(study.marks.reserves.map((mark) => [mark.id, mark.name]))
  const rejected = rejectedSummary(ranked?.rejected ?? [])
  const blind = intentIsEmpty(intent)

  return (
    <div className="glass flex max-h-full w-80 flex-col rounded-xl p-3">
      <div className="mb-2 flex items-center justify-between text-xs tracking-wide text-(--text-dim)">
        <span className="flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5" strokeWidth={1.75} />
          ENEMY COURSES {ranked ? `(${ranked.courses.length})` : ''}
        </span>
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
      </div>

      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
        <div>
          <div className="px-0.5 text-[10px] tracking-wide text-(--text-dim)">
            WHAT THE ENEMY WANTS ({intent.objective_ids.length})
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {study.marks.objectives.map((objective) => {
              const chosen = intent.objective_ids.includes(objective.id)
              return (
                <button
                  key={objective.id}
                  type="button"
                  onClick={() => onToggleObjective(objective.id)}
                  className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                    chosen
                      ? 'border-(--accent-border) bg-(--accent-bg) text-(--text-h)'
                      : 'border-(--border) text-(--text-dim) hover:text-(--text-h)'
                  }`}
                >
                  {objective.name}
                </button>
              )
            })}
          </div>
        </div>

        <label className="block text-[10px] tracking-wide text-(--text-dim)">
          INTELLIGENCE NARRATIVE
          <textarea
            value={intent.narrative}
            maxLength={4000}
            rows={3}
            placeholder="Write it as you would in an intelligence summary. It reaches the model unedited."
            onChange={(event) => onSetIntent({ narrative: event.target.value })}
            className="mt-1 w-full resize-y rounded-md border border-(--border) bg-(--panel-bg-solid) px-2 py-1.5 text-xs text-(--text-h) placeholder:text-(--text-dim) focus:border-(--accent) focus:outline-none"
          />
        </label>

        {blind && (
          <div className="flex items-start gap-1.5 rounded-md bg-amber-400/10 p-2 text-[11px] text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            With no objective or narrative the model has only terrain, and what comes back is
            geography rather than intelligence.
          </div>
        )}

        <button
          type="button"
          disabled={running || study.result.corridors.length === 0}
          onClick={onAssess}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-(--accent) py-2 text-sm font-medium text-(--panel-bg-solid) hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-(--text-dim)"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
          {running ? 'Assessing…' : ranked ? 'Re-assess courses' : 'Assess enemy courses'}
        </button>

        {study.result.corridors.length === 0 && (
          <div className="px-1 text-[11px] text-(--text-dim)">
            There are no corridors to assess. Run the route study first.
          </div>
        )}

        {rejected.length > 0 && (
          <div className="rounded-lg border border-(--hostile)/30 bg-(--hostile)/10 p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] tracking-wide text-(--hostile)">
              <AlertTriangle className="h-3.5 w-3.5" /> DROPPED — GROUND THAT DOES NOT EXIST
            </div>
            {rejected.map((line) => (
              <div key={line} className="text-[11px] text-(--text)">
                {line}
              </div>
            ))}
            <div className="mt-1 text-[10px] text-(--text-dim)">
              What remains is a subset of what the model proposed.
            </div>
          </div>
        )}

        {ranked?.courses.map((course) => (
          <CourseRow
            key={course.name}
            course={course}
            tags={courseTags(ranked, course)}
            selected={selectedCourseName === course.name}
            corridorNames={corridorNames}
            reserveNames={reserveNames}
            onSelect={() => onSelectCourse(selectedCourseName === course.name ? null : course.name)}
            onJudge={(verdict) => onJudge(course.name, verdict)}
          />
        ))}

        {ranked && ranked.courses.length === 0 && (
          <div className="px-1 py-2 text-xs text-(--text-dim)">
            The model returned no course it could ground in this study.
          </div>
        )}

        {ranked && (
          <p className="px-0.5 pt-1 text-[10px] leading-relaxed text-(--text-dim)">
            Scores are the model's judgement on a scale, not probabilities. This pass is the one
            thing in the engine that does not repeat: record an assessment you may need to defend.
            {preferences && preferences.verdicts > 0
              ? ` Ranking has been shaped by ${preferences.verdicts} verdict${preferences.verdicts === 1 ? '' : 's'}.`
              : ''}
          </p>
        )}
      </div>
    </div>
  )
}

function CourseRow({
  course,
  tags,
  selected,
  corridorNames,
  reserveNames,
  onSelect,
  onJudge,
}: {
  course: CourseOfAction
  tags: string[]
  selected: boolean
  corridorNames: Map<string, { label: string; color: string }>
  reserveNames: Map<string, string>
  onSelect: () => void
  onJudge: (verdict: Verdict) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Course ${course.name}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onSelect()
        }
      }}
      className={`rounded-lg border p-2.5 transition-colors ${
        selected
          ? 'border-(--accent-border) bg-(--accent-bg)'
          : 'border-transparent bg-white/3 hover:bg-white/5'
      }`}
    >
      <div className="text-sm text-(--text-h)">{course.name}</div>

      {tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className={`rounded px-1.5 py-0.5 text-[10px] tracking-wide ${
                tag === 'most dangerous'
                  ? 'bg-(--hostile)/15 text-(--hostile)'
                  : 'bg-(--accent)/15 text-(--accent)'
              }`}
            >
              {tag.toUpperCase()}
            </span>
          ))}
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-(--text-dim)">
        <span>likelihood {formatScore(course.likelihood)}</span>
        <span>·</span>
        <span>danger {formatScore(course.danger)}</span>
        <span>·</span>
        <span>
          {course.efforts.length} effort{course.efforts.length === 1 ? '' : 's'}
        </span>
      </div>

      {selected && (
        <div className="mt-2 border-t border-(--border) pt-2" onClick={(event) => event.stopPropagation()}>
          <p className="text-[11px] leading-relaxed text-(--text)">{course.narrative}</p>

          <div className="mt-2 flex flex-col gap-1.5">
            {course.efforts.map((effort, index) => {
              const corridor = corridorNames.get(effort.corridor_id)
              return (
                <div key={`${effort.corridor_id}:${index}`} className="flex gap-1.5">
                  <span
                    className="mt-1 h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: corridor?.color ?? '#64748b' }}
                  />
                  <div className="min-w-0">
                    <div className="text-[11px] text-(--text-h)">
                      {effort.kind === 'main' ? 'Main effort' : 'Supporting'} ·{' '}
                      {corridor?.label ?? effort.corridor_id}
                    </div>
                    <div className="text-[10px] text-(--text-dim)">
                      {reserveNames.get(effort.reserve_id) ?? effort.reserve_id}
                      {effort.rationale ? ` — ${effort.rationale}` : ''}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-2 flex gap-1.5">
            <VerdictButton
              tone="accept"
              onClick={() => onJudge('accepted')}
              label="Sound assessment"
            />
            <VerdictButton tone="reject" onClick={() => onJudge('rejected')} label="Discount this" />
          </div>
          <div className="mt-1 text-[10px] text-(--text-dim)">
            A verdict teaches the ranking what this commander cares about. It never changes the
            doctrinal pair above.
          </div>
        </div>
      )}
    </div>
  )
}

function VerdictButton({
  tone,
  label,
  onClick,
}: {
  tone: 'accept' | 'reject'
  label: string
  onClick: () => void
}) {
  const accept = tone === 'accept'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border border-(--border) py-1.5 text-[11px] transition-colors ${
        accept ? 'hover:border-(--accent-border) hover:text-(--accent)' : 'hover:border-(--hostile)/40 hover:text-(--hostile)'
      }`}
    >
      {accept ? <ThumbsUp className="h-3.5 w-3.5" /> : <ThumbsDown className="h-3.5 w-3.5" />}
      {label}
    </button>
  )
}
