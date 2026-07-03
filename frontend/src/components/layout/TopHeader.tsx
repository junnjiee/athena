import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Pencil, Layers, Thermometer, Cloud, Moon, SlidersHorizontal, Sparkles } from 'lucide-react'

export type HeaderTab = 'layers' | 'heatmaps' | 'weather'

const TABS: { id: HeaderTab; label: string; icon: typeof Layers }[] = [
  { id: 'layers', label: 'Layers', icon: Layers },
  { id: 'heatmaps', label: 'Heatmaps', icon: Thermometer },
  { id: 'weather', label: 'Weather', icon: Cloud },
]

interface Props {
  activeTab: HeaderTab
  onTabChange: (tab: HeaderTab) => void
  centerLabel: string | null
  name: string
  onNameChange: (name: string) => void
  autoEditSignal: number
  canName: boolean
}

export function TopHeader({ activeTab, onTabChange, centerLabel, name, onNameChange, autoEditSignal, canName }: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  // "Adjust state during render" (React's sanctioned pattern for reacting to a prop
  // change without an effect) -- autoEditSignal is a one-shot bump from the parent,
  // not stateful data, so this can't be derived directly; comparing against the last
  // seen signal and updating synchronously during render avoids an extra effect pass.
  const [lastAutoEditSignal, setLastAutoEditSignal] = useState(autoEditSignal)
  if (autoEditSignal !== lastAutoEditSignal) {
    setLastAutoEditSignal(autoEditSignal)
    if (autoEditSignal !== 0) {
      setDraft(name)
      setIsEditing(true)
    }
  }

  useEffect(() => {
    if (isEditing) inputRef.current?.focus()
  }, [isEditing])

  function startEditing() {
    if (!canName) return
    setDraft(name)
    setIsEditing(true)
  }

  function commit() {
    const trimmed = draft.trim()
    if (trimmed) onNameChange(trimmed)
    setIsEditing(false)
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-(--border) bg-(--panel-bg-solid) px-5">
      <div>
        <div className="flex items-center gap-1 text-xs text-(--text-dim)">
          <span>main</span>
          <ChevronRight className="h-3 w-3" />
          <span>Battleground</span>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setIsEditing(false)
              }}
              className="border-b border-(--accent) bg-transparent text-base font-medium text-(--text-h) outline-none"
            />
          ) : (
            <>
              <h1
                title={canName ? undefined : 'Select an area on the map to begin'}
                className={`text-base font-medium ${
                  canName ? 'cursor-pointer text-(--text-h)' : 'cursor-default text-(--text-dim)'
                }`}
                onClick={startEditing}
              >
                {name || (canName ? 'New Battleground' : 'Select ground to begin')}
              </h1>
              {canName && (
                <Pencil
                  className="h-3.5 w-3.5 cursor-pointer text-(--text-dim) hover:text-(--text-h)"
                  onClick={startEditing}
                />
              )}
            </>
          )}
        </div>
        {centerLabel && <div className="text-xs text-(--text-dim)">{centerLabel}</div>}
      </div>

      <div className="flex items-center gap-1 rounded-lg border border-(--border) bg-white/5 p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              activeTab === id ? 'bg-white/10 text-(--text-h)' : 'text-(--text) hover:text-(--text-h)'
            }`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-(--text)">
          <span>24°C</span>
          <span className="text-(--border-strong)">|</span>
          <Moon className="h-4 w-4" strokeWidth={1.75} />
          <span>Night (21:00)</span>
        </div>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-(--border) text-(--text) hover:text-(--text-h)"
        >
          <SlidersHorizontal className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md bg-(--accent) px-3 py-1.5 text-sm font-medium text-(--panel-bg-solid) hover:bg-(--accent-hover)"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
          AI Assistant
        </button>
      </div>
    </header>
  )
}
