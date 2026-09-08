import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Check, Loader2, Sparkles } from 'lucide-react'
import { useBattleground } from '../../state/battleground'
import type { ReasoningStep } from '../../types/terrain'

interface Props {
  visible?: boolean
  steps?: ReasoningStep[]
  error?: string | null
  title?: string
  errorTitle?: string
  onDismissError?: () => void
}

/** Center-screen streamed-progress checklist. With no props it remains the
 *  tactical terrain panel; the operational-area page supplies its roads / DEM /
 *  graph steps so both pipelines share one interaction and animation pattern. */
export function ReasoningPanel(props: Props = {}) {
  const battlefieldPhase = useBattleground((s) => s.phase)
  const battlefieldSteps = useBattleground((s) => s.steps)
  const battlefieldError = useBattleground((s) => s.error)
  const dismissBattlefieldError = useBattleground((s) => s.dismissError)

  const visible = props.visible ?? battlefieldPhase === 'generating'
  const steps = props.steps ?? battlefieldSteps
  const error = props.error === undefined ? battlefieldError : props.error
  const dismissError = props.onDismissError ?? dismissBattlefieldError

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="glass-deep pointer-events-auto w-80 rounded-2xl p-4"
        >
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-(--accent)" strokeWidth={1.75} />
            <span className="text-sm font-medium tracking-wide text-(--text-h)">
              {props.title ?? 'ATHENA IS REASONING'}
            </span>
          </div>

          <div className="flex flex-col gap-1">
            {steps.map((step, i) => (
              <StepRow key={step.id} step={step} index={i} />
            ))}
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-3 rounded-md border border-(--hostile)/40 bg-(--hostile)/10 p-2.5 text-xs text-(--text-h)"
            >
              <div className="mb-1.5 flex items-center gap-1.5 text-(--hostile)">
                <AlertTriangle className="h-3.5 w-3.5" />
                {props.errorTitle ?? 'Terrain generation failed'}
              </div>
              <div className="text-(--text)">{error}</div>
              <button
                type="button"
                onClick={dismissError}
                className="mt-2 w-full rounded border border-(--border) py-1 text-(--text) hover:text-(--text-h)"
              >
                Dismiss
              </button>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function StepRow({ step, index }: { step: ReasoningStep; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
      className="flex items-start gap-2.5 rounded-md px-1.5 py-1.5"
    >
      <StepIcon status={step.status} />
      <div className="min-w-0 flex-1">
        <div
          className={`text-sm leading-tight ${
            step.status === 'done'
              ? 'text-(--text)'
              : step.status === 'active'
                ? 'text-(--text-h)'
                : step.status === 'error'
                  ? 'text-(--hostile)'
                  : 'text-(--text-dim)'
          }`}
        >
          {step.label}
        </div>
        <AnimatePresence>
          {step.detail && step.status !== 'pending' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="truncate text-xs text-(--text-dim)"
            >
              {step.detail}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

function StepIcon({ status }: { status: ReasoningStep['status'] }) {
  if (status === 'done') {
    return (
      <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} className="mt-0.5 text-(--accent)">
        <Check className="h-4 w-4" strokeWidth={2.5} />
      </motion.span>
    )
  }
  if (status === 'active') {
    return (
      <span className="mt-0.5 text-(--accent)">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="mt-0.5 text-(--hostile)">
        <AlertTriangle className="h-4 w-4" strokeWidth={2} />
      </span>
    )
  }
  return <span className="mt-1.5 ml-1 mr-1 block h-1.5 w-1.5 rounded-full bg-(--text-dim)/50" />
}
