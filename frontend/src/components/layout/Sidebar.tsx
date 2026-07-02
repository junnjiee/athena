import { Triangle, Map, ClipboardList, Activity, Radar, Users, Settings } from 'lucide-react'

const NAV_ITEMS = [
  { label: 'Battleground', icon: Map, active: true },
  { label: 'Plans', icon: ClipboardList, active: false },
  { label: 'Simulations', icon: Activity, active: false },
  { label: 'Intel', icon: Radar, active: false },
  { label: 'Units', icon: Users, active: false },
  { label: 'Settings', icon: Settings, active: false },
]

export function Sidebar() {
  return (
    <aside className="flex h-full w-52 shrink-0 flex-col border-r border-(--border) bg-(--panel-bg-solid)">
      <div className="flex items-center gap-2 px-5 py-5">
        <Triangle className="h-4 w-4 text-(--text-h)" strokeWidth={2.5} />
        <span className="text-sm font-semibold tracking-widest text-(--text-h)">ATHENA</span>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ label, icon: Icon, active }) => (
          <div
            key={label}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
              active
                ? 'bg-white/10 text-(--text-h)'
                : 'text-(--text) hover:bg-white/5 hover:text-(--text-h)'
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
            {label}
          </div>
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
