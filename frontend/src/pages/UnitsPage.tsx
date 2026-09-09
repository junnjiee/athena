import { Plus, RotateCcw, Trash2, Users } from 'lucide-react'
import { Sidebar } from '../components/layout/Sidebar'
import { useOrbat } from '../state/orbat'
import { LOAD_PRESETS, type LoadPreset } from '../types/movement'
import { STRENGTH_RANGE, VISION_RANGE_M, type Echelon, type UnitTemplate } from '../types/orbat'
import type { ForceSide } from '../types/entities'
import { useRailOffset } from '../state/shell'

type Preset = Exclude<LoadPreset, 'custom'>

const SIDE_LABEL: Record<ForceSide, string> = { blue: 'BLUE FORCE', red: 'RED FORCE' }

function TemplateRow({ template }: { template: UnitTemplate }) {
  const updateTemplate = useOrbat((s) => s.updateTemplate)
  const removeTemplate = useOrbat((s) => s.removeTemplate)

  const field =
    'rounded-md border border-(--border) bg-black/20 px-2 py-1 text-xs text-(--text-h) focus:border-(--border-strong) focus:outline-none'

  return (
    <div className="glass flex flex-col gap-3 rounded-xl p-4">
      <div className="flex items-center gap-3">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            template.side === 'blue' ? 'bg-(--accent)' : 'bg-(--hostile)'
          }`}
        />
        <input
          value={template.name}
          onChange={(e) => updateTemplate(template.id, { name: e.target.value })}
          aria-label="Template name"
          className="min-w-0 flex-1 border-b border-transparent bg-transparent text-sm text-(--text-h) hover:border-(--border) focus:border-(--accent) focus:outline-none"
        />
        <span className="shrink-0 rounded-md bg-white/5 px-2 py-0.5 text-xs text-(--text-dim)">
          {template.echelon}
        </span>
        <button
          type="button"
          title="Delete establishment"
          onClick={() => removeTemplate(template.id)}
          className="shrink-0 rounded-md p-1.5 text-(--text-dim) transition-colors hover:text-(--hostile)"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="flex items-center gap-2 text-xs text-(--text-dim)">
          Soldiers
          <input
            type="number"
            min={STRENGTH_RANGE.min}
            max={STRENGTH_RANGE.max}
            value={template.strength}
            onChange={(e) => updateTemplate(template.id, { strength: Number(e.target.value) })}
            className={`w-16 text-right ${field}`}
          />
        </label>

        <label className="flex items-center gap-2 text-xs text-(--text-dim)">
          Vision
          <input
            type="number"
            min={VISION_RANGE_M.min}
            max={VISION_RANGE_M.max}
            step={50}
            value={template.visionRangeM}
            onChange={(e) => updateTemplate(template.id, { visionRangeM: Number(e.target.value) })}
            className={`w-20 text-right ${field}`}
          />
          m
        </label>

        <label className="flex items-center gap-2 text-xs text-(--text-dim)">
          Load
          <select
            value={template.loadPreset}
            onChange={(e) => updateTemplate(template.id, { loadPreset: e.target.value as Preset })}
            className={field}
          >
            {(Object.keys(LOAD_PRESETS) as Preset[]).map((preset) => (
              <option key={preset} value={preset} className="bg-(--panel-bg-solid)">
                {LOAD_PRESETS[preset].label} · {LOAD_PRESETS[preset].loadMassKg} kg
              </option>
            ))}
          </select>
        </label>
      </div>

      <input
        value={template.notes}
        onChange={(e) => updateTemplate(template.id, { notes: e.target.value })}
        placeholder="Notes (operator only — never sent to the engine)"
        aria-label="Notes"
        className="w-full bg-transparent text-xs text-(--text) placeholder:text-(--text-dim) focus:outline-none"
      />
    </div>
  )
}

export function UnitsPage() {
  const railOffset = useRailOffset()
  const templates = useOrbat((s) => s.templates)
  const addTemplate = useOrbat((s) => s.addTemplate)
  const resetToDefaults = useOrbat((s) => s.resetToDefaults)

  const bySide = (side: ForceSide) => templates.filter((t) => t.side === side)

  function addButton(side: ForceSide, echelon: Echelon) {
    return (
      <button
        key={`${side}-${echelon}`}
        type="button"
        onClick={() => addTemplate(side, echelon)}
        className="flex items-center gap-1.5 rounded-md border border-(--border) px-2.5 py-1.5 text-xs text-(--text) transition-colors hover:border-(--border-strong) hover:text-(--text-h)"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        {echelon}
      </button>
    )
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-(--bg) text-(--text)">
      <Sidebar />
      <div className={`absolute top-4 right-4 bottom-4 ${railOffset}`}>
        <div className="glass-deep flex h-full flex-col rounded-2xl p-6">
          <div className="mb-2 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm tracking-wide text-(--text-dim)">
              <Users className="h-4 w-4" strokeWidth={1.75} />
              ORDER OF BATTLE
            </div>
            <button
              type="button"
              onClick={resetToDefaults}
              className="flex items-center gap-1.5 rounded-md border border-(--border) px-2.5 py-1.5 text-xs text-(--text) transition-colors hover:border-(--border-strong) hover:text-(--text-h)"
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
              Reset to defaults
            </button>
          </div>

          <p className="mb-5 max-w-2xl text-xs leading-relaxed text-(--text-dim)">
            Establishments the placement tools stamp down. Strength and vision range are the fields
            the simulation engine models per soldier — a unit placed from a template carries them
            into the plan brief, so the engine doesn't have to guess.
          </p>

          <div className="flex max-w-3xl flex-col gap-6 overflow-y-auto pr-2">
            {(['blue', 'red'] as ForceSide[]).map((side) => (
              <section key={side} className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-sm tracking-wide text-(--text-h)">{SIDE_LABEL[side]}</h2>
                  <div className="flex items-center gap-2">
                    {addButton(side, 'section')}
                    {addButton(side, 'platoon')}
                  </div>
                </div>

                {bySide(side).length === 0 ? (
                  <div className="glass rounded-xl p-4 text-xs text-(--text-dim)">
                    No establishments. Placement tools will stamp bare markers with no strength or
                    vision range, and the engine will apply its own defaults.
                  </div>
                ) : (
                  bySide(side).map((template) => (
                    <TemplateRow key={template.id} template={template} />
                  ))
                )}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
