import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, MessageSquare, Pause, Play, X } from 'lucide-react'
import { currentStep, usePlayback } from '../../state/playback'
import { FRIENDLY_HEX, HOSTILE_HEX } from '../../lib/colors'

/**
 * Transport for a run being watched over the battleground.
 *
 * Sits with the map rather than in a modal, because the map is the thing being
 * watched: scrubbing a run and looking at the ground it crossed are the same
 * action, and a dialog over the top of the battlefield makes them two.
 */

export function PlaybackBar() {
  const replay = usePlayback((s) => s.replay)
  const label = usePlayback((s) => s.label)
  const step = usePlayback((s) => s.step)
  const playing = usePlayback((s) => s.playing)
  const setStep = usePlayback((s) => s.setStep)
  const setPlaying = usePlayback((s) => s.setPlaying)
  const advance = usePlayback((s) => s.advance)
  const close = usePlayback((s) => s.close)
  const density = usePlayback((s) => s.density)
  const densityLayer = usePlayback((s) => s.densityLayer)
  const setDensityLayer = usePlayback((s) => s.setDensityLayer)
  const showReasoning = usePlayback((s) => s.showReasoning)
  const setShowReasoning = usePlayback((s) => s.setShowReasoning)
  const tickMs = usePlayback((s) => s.tickMs)
  const setTickMs = usePlayback((s) => s.setTickMs)
  const shown = usePlayback(currentStep)

  useEffect(() => {
    if (!playing || !replay) return
    const timer = setInterval(advance, tickMs)
    return () => clearInterval(timer)
  }, [playing, replay, advance, tickMs])

  if (!replay) return null

  const last = replay.steps.length - 1
  const alive = { blue: 0, red: 0 }
  for (const soldier of shown?.soldiers ?? []) {
    if (soldier.survival_status === 'alive') alive[soldier.team] += 1
  }

  return (
    <div className="glass pointer-events-auto flex items-center gap-3 rounded-xl px-3 py-2">
      <button
        type="button"
        title={playing ? 'Pause' : 'Play'}
        onClick={() => setPlaying(!playing)}
        className="rounded-md p-1 text-(--text-dim) transition-colors hover:text-(--text-h)"
      >
        {playing ? (
          <Pause className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <Play className="h-4 w-4" strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        title="Previous tick"
        onClick={() => setStep(Math.max(0, step - 1))}
        className="rounded-md p-1 text-(--text-dim) transition-colors hover:text-(--text-h)"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        title="Next tick"
        onClick={() => setStep(Math.min(last, step + 1))}
        className="rounded-md p-1 text-(--text-dim) transition-colors hover:text-(--text-h)"
      >
        <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
      </button>

      <input
        type="range"
        min={0}
        max={last}
        value={Math.min(step, last)}
        onChange={(event) => setStep(Number(event.target.value))}
        className="w-56 accent-(--accent)"
      />

      <div className="shrink-0 text-xs tabular-nums text-(--text-dim)">
        t{Math.min(step, last)}/{last} ·{' '}
        <span style={{ color: FRIENDLY_HEX }}>{alive.blue}</span>
        {' v '}
        <span style={{ color: HOSTILE_HEX }}>{alive.red}</span>
      </div>

      {/* What this plan does across every run, not just the one playing. The
          drape underneath is what a commander corrects the plan against. */}
      {density && (
        <div className="flex items-center gap-1 border-l border-(--border) pl-3">
          {(
            [
              ['blue', 'Blue paths'],
              ['red', 'Red paths'],
              ['casualties', 'Losses'],
              ['none', 'Off'],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              type="button"
              title={`${text} across ${density.runs} run${density.runs === 1 ? '' : 's'}`}
              onClick={() => setDensityLayer(value)}
              className={`rounded px-1.5 py-0.5 text-[10px] tracking-wide transition-colors ${
                densityLayer === value
                  ? 'bg-white/10 text-(--text-h)'
                  : 'text-(--text-dim) hover:text-(--text-h)'
              }`}
            >
              {text}
            </button>
          ))}
        </div>
      )}

      {/* Soldiers walk between ticks now, so speed is a real control rather
          than a slideshow rate. */}
      <div className="flex items-center gap-1 border-l border-(--border) pl-3">
        {([[1400, '0.5x'], [700, '1x'], [300, '2x'], [120, '5x']] as const).map(
          ([ms, text]) => (
            <button
              key={ms}
              type="button"
              onClick={() => setTickMs(ms)}
              className={`rounded px-1.5 py-0.5 text-[10px] tracking-wide transition-colors ${
                tickMs === ms
                  ? 'bg-white/10 text-(--text-h)'
                  : 'text-(--text-dim) hover:text-(--text-h)'
              }`}
            >
              {text}
            </button>
          ),
        )}
      </div>

      <button
        type="button"
        title={showReasoning ? 'Hide what commanders are saying' : 'Show what commanders are saying'}
        onClick={() => setShowReasoning(!showReasoning)}
        className={`rounded-md p-1 transition-colors ${
          showReasoning ? 'text-(--text-h)' : 'text-(--text-dim) hover:text-(--text-h)'
        }`}
      >
        <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
      </button>

      <div className="max-w-32 truncate text-xs text-(--text-dim)" title={label}>
        {label}
      </div>

      <button
        type="button"
        title="Stop watching"
        onClick={close}
        className="rounded-md p-1 text-(--text-dim) transition-colors hover:text-(--text-h)"
      >
        <X className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  )
}
