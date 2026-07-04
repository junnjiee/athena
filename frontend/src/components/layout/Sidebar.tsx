import { Triangle, Map, ClipboardList, Activity, Radar, Users, Settings } from 'lucide-react'

const NAV_ITEMS = [
  { label: 'Battleground', icon: Map, active: true },
  { label: 'Plans', icon: ClipboardList, active: false },
  { label: 'Simulations', icon: Activity, active: false },
  { label: 'Intel', icon: Radar, active: false },
  { label: 'Units', icon: Users, active: false },
  { label: 'Settings', icon: Settings, active: false },
]

/** Floating glass navigation rail — self-positioned on the left edge. */
export function Sidebar() {
  return (
    <aside className="glass-deep pointer-events-auto absolute top-4 bottom-4 left-4 z-30 flex w-52 flex-col rounded-2xl">
      <div className="flex items-center gap-2 px-5 py-5">
        <Triangle className="h-4 w-4 text-(--text-h)" strokeWidth={2.5} />
        <span className="text-sm font-semibold tracking-widest text-(--text-h)">ATHENA</span>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ label, icon: Icon, active }) => (
          <button
            key={label}
            type="button"
            className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              active
                ? 'bg-white/10 text-(--text-h)'
                : 'text-(--text) hover:bg-white/5 hover:text-(--text-h)'
            }`}
          >
            {active && (
              <span className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-(--accent)" />
            )}
            <Icon className="h-4 w-4" strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </nav>

      <div className="mt-auto flex items-center gap-2 border-t border-(--border) px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-medium text-(--text-h)">
          TC
        </div>
        <div className="leading-tight">
          <div className="text-sm text-(--text-h)">Tim Chia</div>
          <div className="text-xs text-(--text-dim)">Commander</div>
        </div>
      </div>
    </aside>
  )
}
