import { Check } from 'lucide-react'
import type { PlanningStep } from '../../lib/planningSteps'

/** The one line telling the operator what to do next, over a dot per step.
 *
 *  Sits where the tool hint used to: the hint is what the armed tool wants
 *  right now, the guide is what the study wants next, and showing the hint in
 *  the guide's place while a tool is armed keeps one voice on screen instead of
 *  two competing pills. */
export function NextStepGuide({
  steps,
  current,
  hint,
  actionLabel,
  onAction,
}: {
  steps: PlanningStep[]
  current: PlanningStep | null
  /** What the armed tool is waiting for, if any. Takes over the line. */
  hint: string | null
  actionLabel: string | null
  onAction: () => void
}) {
  const index = current ? steps.findIndex((step) => step.id === current.id) : steps.length

  return (
    <div className="glass pointer-events-auto flex max-w-xl items-center gap-3 rounded-xl px-3 py-2">
      <div className="flex shrink-0 items-center gap-1" aria-hidden>
        {steps.map((step) => (
          <span
            key={step.id}
            title={step.label}
            className={`h-1.5 rounded-full transition-all ${
              step.status === 'current'
                ? 'w-5 bg-(--accent)'
                : step.status === 'done'
                  ? 'w-1.5 bg-(--accent)/50'
                  : 'w-1.5 bg-white/15'
            }`}
          />
        ))}
      </div>

      <div className="min-w-0 flex-1">
        {current ? (
          <>
            <div className="text-[10px] tracking-wide text-(--text-dim)">
              STEP {index + 1} OF {steps.length} · {current.label.toUpperCase()}
            </div>
            <div className="text-xs text-(--text-h)">{hint ?? current.action}</div>
          </>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-(--text-h)">
            <Check className="h-3.5 w-3.5 text-(--accent)" />
            {hint ?? 'Every pass is complete. Revisit any tab to refine the plan.'}
          </div>
        )}
      </div>

      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 rounded-md bg-(--accent) px-2.5 py-1.5 text-xs font-medium text-(--panel-bg-solid) hover:bg-(--accent-hover)"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
