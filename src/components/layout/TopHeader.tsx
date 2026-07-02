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
}

export function TopHeader({ activeTab, onTabChange, centerLabel }: Props) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-(--border) bg-(--panel-bg-solid) px-5">
      <div>
        <div className="flex items-center gap-1 text-xs text-(--text-dim)">
          <span>main</span>
          <ChevronRight className="h-3 w-3" />
          <span>Battleground</span>
        </div>
        <div className="flex items-center gap-2">
          <h1 className="text-base font-medium text-(--text-h)">New Battleground</h1>
          <Pencil className="h-3.5 w-3.5 text-(--text-dim)" />
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
