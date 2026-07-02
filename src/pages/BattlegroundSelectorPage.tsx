import { useState } from 'react'
import { CesiumGlobe } from '../components/globe/CesiumGlobe'
import { MapToolbar } from '../components/toolbar/MapToolbar'
import { SelectionStatsPanel } from '../components/panels/SelectionStatsPanel'
import type { SelectionResult } from '../types/selection'

export function BattlegroundSelectorPage() {
  const [armed, setArmed] = useState(false)
  const [selection, setSelection] = useState<SelectionResult | null>(null)
  const [resetToken, setResetToken] = useState(0)

  return (
    <div className="relative h-screen w-screen">
      <CesiumGlobe
        armed={armed}
        resetToken={resetToken}
        onSelectionFinalize={(result) => {
          setSelection(result)
          setArmed(false)
        }}
      />
      <MapToolbar armed={armed} onToggle={() => setArmed((a) => !a)} />
      <SelectionStatsPanel
        selection={selection}
        onClear={() => {
          setSelection(null)
          setResetToken((t) => t + 1)
        }}
      />
    </div>
  )
}
