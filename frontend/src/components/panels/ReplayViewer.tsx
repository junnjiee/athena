import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Pause, Play } from 'lucide-react'
import { fetchReplay } from '../../lib/api'
import { FRIENDLY_HEX, HOSTILE_HEX } from '../../lib/colors'
import { TERRAIN_CLASS } from '../../types/terrain'
import type { ReplayLog, ReplayStep } from '../../types/replay'

/**
 * One run, played back over the ground it was fought on.
 *
 * The replay is schema 4, which no longer carries the battlefield's elevation —
 * that was 92% of a 17 MB file and identical in every run of a batch. It still
 * carries the class grid, so this draws terrain from the replay itself and needs
 * nothing else loaded.
 */

interface Props {
  replayPath: string
  label: string
  onClose: () => void
}

/** Muted terrain palette. Deliberately low-contrast: the soldiers are the
 *  subject, and the ground is context they have to read past. */
const CLASS_FILL: Record<number, string> = {
  [TERRAIN_CLASS.OPEN]: '#2a2e2b',
  [TERRAIN_CLASS.GRASS]: '#2f3a2d',
  [TERRAIN_CLASS.SCRUB]: '#38402e',
  [TERRAIN_CLASS.FOREST]: '#1f3324',
  [TERRAIN_CLASS.WETLAND]: '#26353a',
  [TERRAIN_CLASS.WATER]: '#1b2c42',
  [TERRAIN_CLASS.URBAN]: '#3a3a3f',
  [TERRAIN_CLASS.BUILDING]: '#4a4a52',
  [TERRAIN_CLASS.ROAD]: '#45423a',
  [TERRAIN_CLASS.BARREN]: '#3d3a35',
  // Engine-side class: works a commander drew, absent from the terrain pipeline.
  10: '#5a4a30',
}

const TICK_MS = 450

function drawStep(
  canvas: HTMLCanvasElement,
  replay: ReplayLog,
  step: ReplayStep,
): void {
  const context = canvas.getContext('2d')
  if (!context) return

  const { width, height, terrain_classes } = replay.battlefield
  // One device pixel per cell, scaled up by CSS — a 150x150 ground is a small
  // image, and nearest-neighbour scaling keeps cells legible.
  canvas.width = width
  canvas.height = height

  const image = context.createImageData(width, height)
  for (let i = 0; i < terrain_classes.length; i++) {
    const hex = CLASS_FILL[terrain_classes[i]] ?? CLASS_FILL[TERRAIN_CLASS.OPEN]
    image.data[i * 4] = parseInt(hex.slice(1, 3), 16)
    image.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16)
    image.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16)
    image.data[i * 4 + 3] = 255
  }
  context.putImageData(image, 0, 0)

  // Shots first, so a soldier is never hidden under its own tracer.
  context.lineWidth = 0.6
  for (const shot of step.shots) {
    context.strokeStyle = shot.hit ? '#ffd7a0' : 'rgba(255, 215, 160, 0.35)'
    context.beginPath()
    context.moveTo(shot.shooter_position.x + 0.5, shot.shooter_position.y + 0.5)
    context.lineTo(shot.target_position.x + 0.5, shot.target_position.y + 0.5)
    context.stroke()
  }

  for (const soldier of step.soldiers) {
    const alive = soldier.survival_status === 'alive'
    context.fillStyle = alive
      ? soldier.team === 'blue'
        ? FRIENDLY_HEX
        : HOSTILE_HEX
      : '#6b6b6b'
    context.beginPath()
    context.arc(soldier.position.x + 0.5, soldier.position.y + 0.5, alive ? 2 : 1.4, 0, Math.PI * 2)
    context.fill()
  }
}

export function ReplayViewer({ replayPath, label, onClose }: Props) {
  const [replay, setReplay] = useState<ReplayLog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchReplay(replayPath)
      .then((log) => {
        if (!cancelled) setReplay(log)
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'could not load the replay')
        }
      })
    return () => {
      cancelled = true
    }
  }, [replayPath])

  const lastStep = replay ? replay.steps.length - 1 : 0

  useEffect(() => {
    if (!playing || !replay) return
    const timer = setInterval(() => {
      setStep((current) => (current >= lastStep ? 0 : current + 1))
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [playing, replay, lastStep])

  useEffect(() => {
    if (!replay || !canvasRef.current) return
    drawStep(canvasRef.current, replay, replay.steps[Math.min(step, lastStep)])
  }, [replay, step, lastStep])

  const current = replay?.steps[Math.min(step, lastStep)]
  const alive = useMemo(() => {
    const counts = { blue: 0, red: 0 }
    for (const soldier of current?.soldiers ?? []) {
      if (soldier.survival_status === 'alive') counts[soldier.team] += 1
    }
    return counts
  }, [current])

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="glass-deep flex max-h-full w-full max-w-3xl flex-col gap-3 overflow-auto rounded-2xl p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-baseline justify-between gap-4">
          <div className="text-sm text-(--text-h)">{label}</div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-(--text-dim) transition-colors hover:text-(--text-h)"
          >
            Close
          </button>
        </div>

        {error && <div className="text-sm text-(--hostile)">{error}</div>}
        {!replay && !error && (
          <div className="flex items-center gap-2 text-xs text-(--text-dim)">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            Loading replay…
          </div>
        )}

        {replay && (
          <>
            {/* Height-bounded, not width-bounded: a square ground on a short
                viewport would otherwise push the transport controls off-screen,
                which is where they were the first time this was looked at. */}
            <canvas
              ref={canvasRef}
              className="mx-auto max-h-[55vh] w-auto max-w-full rounded-lg border border-(--border) bg-black"
              style={{
                imageRendering: 'pixelated',
                aspectRatio: `${replay.battlefield.width} / ${replay.battlefield.height}`,
              }}
            />

            <div className="flex items-center gap-3">
              <button
                type="button"
                title={playing ? 'Pause' : 'Play'}
                onClick={() => setPlaying((value) => !value)}
                className="rounded-md p-1.5 text-(--text-dim) transition-colors hover:text-(--text-h)"
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
                onClick={() => {
                  setPlaying(false)
                  setStep((value) => Math.max(0, value - 1))
                }}
                className="rounded-md p-1.5 text-(--text-dim) transition-colors hover:text-(--text-h)"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                title="Next tick"
                onClick={() => {
                  setPlaying(false)
                  setStep((value) => Math.min(lastStep, value + 1))
                }}
                className="rounded-md p-1.5 text-(--text-dim) transition-colors hover:text-(--text-h)"
              >
                <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
              </button>

              <input
                type="range"
                min={0}
                max={lastStep}
                value={Math.min(step, lastStep)}
                onChange={(event) => {
                  setPlaying(false)
                  setStep(Number(event.target.value))
                }}
                className="flex-1 accent-(--accent)"
              />

              <div className="w-40 shrink-0 text-right text-xs tabular-nums text-(--text-dim)">
                tick {Math.min(step, lastStep)}/{lastStep} ·{' '}
                <span style={{ color: FRIENDLY_HEX }}>{alive.blue}</span>
                {' v '}
                <span style={{ color: HOSTILE_HEX }}>{alive.red}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
