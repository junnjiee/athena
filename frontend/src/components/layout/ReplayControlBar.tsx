import { Pause, Play, X } from 'lucide-react'
import { useReplay, type PlaybackSpeed } from '../../state/replay'

const SPEEDS: PlaybackSpeed[] = [1, 2, 4, 8]

interface Props {
  onExit: () => void
}

/** Replaces BottomBar while a replay is loaded -- editing a plan and watching
 *  a replay are mutually exclusive modes, not something to overlay together.
 *  Same glass-deep shell/positioning as BottomBar. */
export function ReplayControlBar({ onExit }: Props) {
  const run = useReplay((s) => s.run)
  const playing = useReplay((s) => s.playing)
  const currentStep = useReplay((s) => s.currentStep)
  const speed = useReplay((s) => s.speed)
  const play = useReplay((s) => s.play)
  const pause = useReplay((s) => s.pause)
  const seek = useReplay((s) => s.seek)
  const setSpeed = useReplay((s) => s.setSpeed)

  if (!run) return null
  const totalSteps = run.replay.steps.length

  return (
    <div className="glass-deep pointer-events-auto flex items-center justify-between gap-6 rounded-2xl px-6 py-3">
      <div className="min-w-0 shrink">
        <div className="text-xs tracking-wide whitespace-nowrap text-(--text-dim)">REPLAY</div>
        <div className="truncate text-sm text-(--text-h)">{run.run.name}</div>
      </div>

      <div className="flex flex-1 items-center gap-3">
        <button
          type="button"
          onClick={() => (playing ? pause() : play())}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--accent) text-(--panel-bg-solid) transition-colors hover:bg-(--accent-hover)"
        >
          {playing ? <Pause className="h-4 w-4" strokeWidth={2} /> : <Play className="h-4 w-4" strokeWidth={2} />}
        </button>

        <span className="shrink-0 text-xs whitespace-nowrap text-(--text-dim)">
          Step {currentStep + 1} / {totalSteps}
        </span>

        <input
          type="range"
          min={0}
          max={totalSteps - 1}
          value={currentStep}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Replay scrub"
          className="w-full accent-[var(--accent)]"
        />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <div className="glass flex items-center gap-0.5 rounded-lg p-0.5">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className={`rounded-md px-2 py-1 text-xs transition-colors ${
                speed === s ? 'bg-(--accent) text-(--panel-bg-solid)' : 'text-(--text-dim) hover:text-(--text-h)'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onExit}
          title="Exit replay"
          className="glass flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-(--text) transition-colors hover:text-(--text-h)"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
          Exit Replay
        </button>
      </div>
    </div>
  )
}
