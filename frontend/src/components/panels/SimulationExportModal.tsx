import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { useBattleground } from '../../state/battleground'
import { buildSimulationExport } from '../../lib/simulationExport'
import type { PlacedObjective, PlacedRoute, PlacedUnit } from '../../types/entities'

interface Props {
  open: boolean
  onClose: () => void
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  routes: PlacedRoute[]
}

/** Pretty-prints like `JSON.stringify(value, null, 2)`, except an array whose
 *  every element is a primitive (the terrain grid's per-cell channels, up to
 *  ~83k numbers each) is kept on one line instead of one element per line. */
function compactStringify(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  const padIn = '  '.repeat(indent + 1)

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const allPrimitive = value.every((v) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')
    if (allPrimitive) return `[${value.map((v) => JSON.stringify(v)).join(',')}]`
    const items = value.map((v) => `${padIn}${compactStringify(v, indent + 1)}`).join(',\n')
    return `[\n${items}\n${pad}]`
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const items = entries
      .map(([k, v]) => `${padIn}${JSON.stringify(k)}: ${compactStringify(v, indent + 1)}`)
      .join(',\n')
    return `{\n${items}\n${pad}}`
  }

  return JSON.stringify(value)
}

export function SimulationExportModal({ open, onClose, units, objectives, routes }: Props) {
  const meta = useBattleground((s) => s.meta)
  const grid = useBattleground((s) => s.grid)
  const planAnalysis = useBattleground((s) => s.planAnalysis)
  const [copied, setCopied] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  // Reset the "Copied" indicator when the modal closes -- done during render
  // (React's documented pattern for resetting state on a prop change) rather
  // than in an effect, to avoid the extra render pass that would cause.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setCopied(false)
  }

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const json = useMemo(() => {
    if (!open) return ''
    return compactStringify(buildSimulationExport({ meta, grid, units, objectives, routes, planAnalysis }))
  }, [open, meta, grid, units, objectives, routes, planAnalysis])

  if (!open) return null

  async function handleCopy() {
    await navigator.clipboard.writeText(json)
    setCopied(true)
  }

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="glass-deep flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-(--text-h)">Simulation Payload (preview)</div>
            <div className="text-xs text-(--text-dim)">
              The Monte Carlo engine isn't built yet — this is the plan + terrain data it will consume.
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-md border border-(--border) px-2.5 py-1.5 text-xs text-(--text) transition-colors hover:border-(--border-strong) hover:text-(--text-h)"
            >
              {copied ? <Check className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />}
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close"
              className="rounded-md p-1.5 text-(--text-dim) transition-colors hover:text-(--text-h)"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
        <pre className="overflow-auto rounded-lg bg-black/20 p-3 text-xs whitespace-pre-wrap break-all text-(--text)">
          {json}
        </pre>
      </div>
    </div>
  )
}
