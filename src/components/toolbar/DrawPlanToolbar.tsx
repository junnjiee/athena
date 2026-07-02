import { MousePointer2, Pencil, Square, Upload, Circle, Diamond } from 'lucide-react'

interface Props {
  armed: boolean
  onToggleArm: () => void
}

export function DrawPlanToolbar({ armed, onToggleArm }: Props) {
  return (
    <div className="w-44 rounded-lg border border-(--border) bg-(--panel-bg) p-3 backdrop-blur-md shadow-(--shadow)">
      <div className="mb-2 text-xs tracking-wide text-(--text-dim)">DRAW / PLAN</div>
      <div className="grid grid-cols-4 gap-1.5">
        <button
          type="button"
          onClick={() => armed && onToggleArm()}
          title="Pointer"
          className={`flex h-8 items-center justify-center rounded-md border ${
            !armed ? 'border-(--accent-border) bg-(--accent-bg) text-(--accent)' : 'border-(--border) text-(--text) hover:text-(--text-h)'
          }`}
        >
          <MousePointer2 className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          disabled
          title="Freeform draw (not yet available)"
          className="flex h-8 items-center justify-center rounded-md border border-(--border) text-(--text-dim) opacity-40"
        >
          <Pencil className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => !armed && onToggleArm()}
          title="Select ground (drag a rectangle)"
          className={`flex h-8 items-center justify-center rounded-md border ${
            armed ? 'border-(--accent-border) bg-(--accent-bg) text-(--accent)' : 'border-(--border) text-(--text) hover:text-(--text-h)'
          }`}
        >
          <Square className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          disabled
          title="Import (not yet available)"
          className="flex h-8 items-center justify-center rounded-md border border-(--border) text-(--text-dim) opacity-40"
        >
          <Upload className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          disabled
          title="Place friendly marker (not yet available)"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-(--border) text-(--friendly) opacity-40"
        >
          <Circle className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          disabled
          title="Place threat marker (not yet available)"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-(--border) text-(--hostile) opacity-40"
        >
          <Diamond className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
