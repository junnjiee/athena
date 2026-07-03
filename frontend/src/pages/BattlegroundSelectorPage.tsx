import { useState } from 'react'
import { CesiumGlobe } from '../components/globe/CesiumGlobe'
import { MapControls } from '../components/globe/MapControls'
import { DrawPlanToolbar } from '../components/toolbar/DrawPlanToolbar'
import { TerrainLayersPanel } from '../components/panels/TerrainLayersPanel'
import { SelectionStatsPanel } from '../components/panels/SelectionStatsPanel'
import { PlanRosterPanel } from '../components/panels/PlanRosterPanel'
import { PlacementHint } from '../components/panels/PlacementHint'
import { Sidebar } from '../components/layout/Sidebar'
import { TopHeader, type HeaderTab } from '../components/layout/TopHeader'
import { BottomBar } from '../components/layout/BottomBar'
import { useMapControls } from '../hooks/useMapControls'
import type { SelectionResult } from '../types/selection'
import type { LonLat, PlacedObjective, PlacedRoute, PlacedUnit, ToolMode } from '../types/entities'

const NATO = [
  'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett',
  'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango',
  'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu',
]

interface NewRouteInput {
  side: PlacedRoute['side']
  startUnitId: string
  points: LonLat[]
  endRef: PlacedRoute['endRef']
}

export function BattlegroundSelectorPage() {
  const [toolMode, setToolMode] = useState<ToolMode>('navigate')
  const [selection, setSelection] = useState<SelectionResult | null>(null)
  const [resetToken, setResetToken] = useState(0)
  const [activeTab, setActiveTab] = useState<HeaderTab>('layers')
  const [battlegroundName, setBattlegroundName] = useState('')
  const [nameEditSignal, setNameEditSignal] = useState(0)
  const [units, setUnits] = useState<PlacedUnit[]>([])
  const [objectives, setObjectives] = useState<PlacedObjective[]>([])
  const [routes, setRoutes] = useState<PlacedRoute[]>([])
  const [isDrawingRoute, setIsDrawingRoute] = useState(false)

  const planningMode = selection !== null && battlegroundName.trim() !== ''

  const {
    handleViewerReady,
    zoomIn,
    zoomOut,
    resetNorth,
    toggleSceneMode,
    toggleSatellite,
    toggleElevation,
    flyToPositions,
    is3D,
    satelliteVisible,
    elevationExaggerated,
  } = useMapControls()

  const centerLabel = selection
    ? `${selection.stats.centerLatitude.toFixed(4)}° N, ${selection.stats.centerLongitude.toFixed(4)}° E`
    : null

  function handlePlace(mode: 'place-blue' | 'place-red' | 'place-objective', position: LonLat) {
    if (mode === 'place-objective') {
      setObjectives((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          name: `OBJ ${NATO[prev.length % 26].toUpperCase()}`,
          description: 'Capture & Hold',
          position,
          radiusMeters: 150,
        },
      ])
      return
    }
    const side = mode === 'place-blue' ? 'blue' : 'red'
    setUnits((prev) => {
      const sideCount = prev.filter((u) => u.side === side).length
      return [...prev, { id: crypto.randomUUID(), side, name: NATO[sideCount % 26], typeLabel: 'PLT', position }]
    })
  }

  function handleRouteComplete(input: NewRouteInput) {
    setRoutes((prev) => [...prev, { id: crypto.randomUUID(), ...input }])
  }

  function handleDeleteUnit(id: string) {
    setUnits((prev) => prev.filter((u) => u.id !== id))
    setRoutes((prev) => prev.filter((r) => r.startUnitId !== id && !(r.endRef?.kind === 'unit' && r.endRef.id === id)))
  }

  function handleDeleteObjective(id: string) {
    setObjectives((prev) => prev.filter((o) => o.id !== id))
    setRoutes((prev) => prev.filter((r) => !(r.endRef?.kind === 'objective' && r.endRef.id === id)))
  }

  function handleDeleteRoute(id: string) {
    setRoutes((prev) => prev.filter((r) => r.id !== id))
  }

  function handleNameChange(name: string) {
    setBattlegroundName(name)
    setToolMode('navigate')
  }

  function handleClear() {
    setSelection(null)
    setResetToken((t) => t + 1)
    if (planningMode) {
      setBattlegroundName('')
      setUnits([])
      setObjectives([])
      setRoutes([])
      setToolMode('navigate')
    }
  }

  return (
    <div className="flex h-screen w-screen bg-(--bg) text-(--text)">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopHeader
          activeTab={activeTab}
          onTabChange={setActiveTab}
          centerLabel={centerLabel}
          name={battlegroundName}
          onNameChange={handleNameChange}
          autoEditSignal={nameEditSignal}
          canName={selection !== null}
        />

        <div className="relative min-h-0 flex-1">
          <CesiumGlobe
            armed={toolMode === 'select-ground'}
            resetToken={resetToken}
            onSelectionFinalize={(result) => {
              setSelection(result)
              setToolMode('navigate')
              if (battlegroundName.trim() === '') setNameEditSignal((t) => t + 1)
            }}
            onViewerReady={handleViewerReady}
            toolMode={toolMode}
            units={units}
            objectives={objectives}
            routes={routes}
            onPlace={handlePlace}
            onRouteComplete={handleRouteComplete}
            onRouteDrawingChange={setIsDrawingRoute}
          />

          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="pointer-events-auto">
                {planningMode && (
                  <PlanRosterPanel
                    units={units}
                    objectives={objectives}
                    routes={routes}
                    onLocate={flyToPositions}
                    onDeleteUnit={handleDeleteUnit}
                    onDeleteObjective={handleDeleteObjective}
                    onDeleteRoute={handleDeleteRoute}
                  />
                )}
              </div>
              {activeTab === 'layers' && (
                <div className="pointer-events-auto flex flex-col gap-3">
                  <DrawPlanToolbar toolMode={toolMode} onSetToolMode={setToolMode} planningMode={planningMode} />
                  <TerrainLayersPanel
                    satelliteVisible={satelliteVisible}
                    onToggleSatellite={toggleSatellite}
                    elevationExaggerated={elevationExaggerated}
                    onToggleElevation={toggleElevation}
                  />
                </div>
              )}
            </div>

            <div className="flex items-end justify-between">
              <div className="pointer-events-auto">
                <SelectionStatsPanel selection={selection} onClear={handleClear} />
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

          {toolMode !== 'navigate' && (
            <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center">
              <PlacementHint toolMode={toolMode} isDrawingRoute={isDrawingRoute} />
            </div>
          )}
        </div>

        <BottomBar canRunSimulation={selection !== null} planName={battlegroundName} />
      </div>
    </div>
  )
}
