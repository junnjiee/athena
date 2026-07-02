interface Props {
  armed: boolean
  onToggle: () => void
}

export function MapToolbar({ armed, onToggle }: Props) {
  return (
    <div className="absolute top-4 left-4 z-10">
      <button
        type="button"
        onClick={onToggle}
        className={`rounded-md border px-4 py-2 text-sm font-medium shadow-(--shadow) transition-colors ${
          armed
            ? 'border-(--accent-border) bg-(--accent) text-white'
            : 'border-(--border) bg-(--bg) text-(--text-h)'
        }`}
      >
        {armed ? 'Selecting… drag on the globe' : 'Select Area'}
      </button>
    </div>
  )
}
