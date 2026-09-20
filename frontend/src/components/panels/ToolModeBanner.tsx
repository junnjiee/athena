import { Crosshair, MapPinned, Route, Scissors, ShieldCheck, Square, Target, X } from 'lucide-react'
import type { OperationalToolMode } from '../../types/routeStudy'

interface Presentation {
  label: string
  icon: React.ReactNode
  /** Tailwind classes for the banner and the frame drawn round the map. */
  chip: string
  frame: string
}

const PRESENTATION: Partial<Record<OperationalToolMode, Presentation>> = {
  'select-area': {
    label: 'Selecting AO',
    icon: <Square className="h-4 w-4" />,
    chip: 'border-(--friendly)/50 bg-(--friendly)/15 text-(--friendly)',
    frame: 'ring-(--friendly)/60',
  },
  'place-reserve': {
    label: 'Placing enemy reserve',
    icon: <Target className="h-4 w-4" />,
    chip: 'border-(--hostile)/50 bg-(--hostile)/15 text-(--hostile)',
    frame: 'ring-(--hostile)/60',
  },
  'draw-objective-area': {
    label: 'Drawing objective',
    icon: <MapPinned className="h-4 w-4" />,
    chip: 'border-(--accent-border) bg-(--accent-bg) text-(--accent)',
    frame: 'ring-(--accent)/60',
  },
  'draw-road': {
    label: 'Adding road',
    icon: <Route className="h-4 w-4" />,
    chip: 'border-white/30 bg-white/10 text-(--text-h)',
    frame: 'ring-white/40',
  },
  'break-road': {
    label: 'Breaking road',
    icon: <Scissors className="h-4 w-4" />,
    chip: 'border-red-400/50 bg-red-950/40 text-red-200',
    frame: 'ring-red-400/60',
  },
  'place-orbat-unit': {
    label: 'Placing own unit',
    icon: <ShieldCheck className="h-4 w-4" />,
    chip: 'border-(--friendly)/50 bg-(--friendly)/15 text-(--friendly)',
    frame: 'ring-(--friendly)/60',
  },
  'place-block-point': {
    label: 'Setting block point',
    icon: <Crosshair className="h-4 w-4" />,
    chip: 'border-(--friendly)/50 bg-(--friendly)/15 text-(--friendly)',
    frame: 'ring-(--friendly)/60',
  },
}

/** Says which tool is armed, loudly, and how to put it down.
 *
 *  A pill at the top of the map plus a coloured frame round its edge: the frame
 *  is visible whatever the operator is looking at, the pill says what a click
 *  will do, and the button on it is the same exit Esc gives. The step guide at
 *  the bottom carries the same hint, but a line of text in a guide is easy to
 *  miss while placing marks; a red frame round the whole map is not. */
export function ToolModeBanner({
  toolMode,
  hint,
  onExit,
}: {
  toolMode: OperationalToolMode
  hint: string | null
  onExit: () => void
}) {
  const presentation = PRESENTATION[toolMode]
  if (!presentation) return null
  return (
    <>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 z-10 rounded-none ring-2 ring-inset ${presentation.frame}`}
      />
      <div className="pointer-events-none absolute top-4 left-1/2 z-30 -translate-x-1/2">
        <div
          role="status"
          className={`glass-deep pointer-events-auto flex max-w-2xl items-center gap-3 rounded-full border py-1.5 pr-1.5 pl-3 ${presentation.chip}`}
        >
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
            {presentation.icon}
            {presentation.label}
          </span>
          {hint && <span className="truncate text-xs text-(--text-h)">{hint}</span>}
          <button
            type="button"
            onClick={onExit}
            title="Exit tool (Esc)"
            className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[11px] text-(--text-h) hover:bg-white/20"
          >
            <X className="h-3 w-3" /> Done
          </button>
        </div>
      </div>
    </>
  )
}
