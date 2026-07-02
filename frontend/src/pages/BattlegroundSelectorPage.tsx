import { useState } from 'react'
import { CesiumGlobe } from '../components/globe/CesiumGlobe'
import { MapControls } from '../components/globe/MapControls'
import { DrawPlanToolbar } from '../components/toolbar/DrawPlanToolbar'
import { TerrainLayersPanel } from '../components/panels/TerrainLayersPanel'
import { SelectionStatsPanel } from '../components/panels/SelectionStatsPanel'
import { Sidebar } from '../components/layout/Sidebar'
import { TopHeader, type HeaderTab } from '../components/layout/TopHeader'
import { BottomBar } from '../components/layout/BottomBar'
import { useMapControls } from '../hooks/useMapControls'
import type { SelectionResult } from '../types/selection'

export function BattlegroundSelectorPage() {
  const [armed, setArmed] = useState(false)
  const [selection, setSelection] = useState<SelectionResult | null>(null)
  const [resetToken, setResetToken] = useState(0)
  const [activeTab, setActiveTab] = useState<HeaderTab>('layers')

  const {
    handleViewerReady,
    zoomIn,
    zoomOut,
    resetNorth,
    toggleSceneMode,
    toggleSatellite,
    is3D,
    satelliteVisible,
  } = useMapControls()

  const centerLabel = selection
    ? `${selection.stats.centerLatitude.toFixed(4)}° N, ${selection.stats.centerLongitude.toFixed(4)}° E`
    : null

  return (
    <div className="flex h-screen w-screen bg-(--bg) text-(--text)">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopHeader activeTab={activeTab} onTabChange={setActiveTab} centerLabel={centerLabel} />

        <div className="relative min-h-0 flex-1">
          <CesiumGlobe
            armed={armed}
            resetToken={resetToken}
            onSelectionFinalize={(result) => {
              setSelection(result)
              setArmed(false)
            }}
            onViewerReady={handleViewerReady}
          />

          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-4">
            <div className="flex items-start justify-end gap-3">
              {activeTab === 'layers' && (
                <div className="pointer-events-auto flex flex-col gap-3">
                  <DrawPlanToolbar armed={armed} onToggleArm={() => setArmed((a) => !a)} />
                  <TerrainLayersPanel satelliteVisible={satelliteVisible} onToggleSatellite={toggleSatellite} />
                </div>
              )}
            </div>

            <div className="flex items-end justify-between">
              <div className="pointer-events-auto">
                <SelectionStatsPanel
                  selection={selection}
                  onClear={() => {
                    setSelection(null)
                    setResetToken((t) => t + 1)
                  }}
                />
              </div>
              <div className="pointer-events-auto">
                <MapControls
                  is3D={is3D}
                  onResetNorth={resetNorth}
                  onToggleSceneMode={toggleSceneMode}
                  onZoomIn={zoomIn}
                  onZoomOut={zoomOut}
                />
              </div>
            </div>
          </div>
        </div>

        <BottomBar canRunSimulation={selection !== null} />
      </div>
    </div>
  )
}
