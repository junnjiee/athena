import { useEffect, useState } from 'react'
import * as Cesium from 'cesium'
import { CesiumGlobe } from '../components/globe/CesiumGlobe'
import { MapControls } from '../components/globe/MapControls'
import { DrawPlanToolbar } from '../components/toolbar/DrawPlanToolbar'
import { TerrainLayersPanel } from '../components/panels/TerrainLayersPanel'
import { SelectionStatsPanel } from '../components/panels/SelectionStatsPanel'
import { PlanRosterPanel } from '../components/panels/PlanRosterPanel'
import { MovementModePanel } from '../components/panels/MovementModePanel'
import { GroundSearchPanel } from '../components/panels/GroundSearchPanel'
import { PlacementHint } from '../components/panels/PlacementHint'
import { ReasoningPanel } from '../components/panels/ReasoningPanel'
import { TerrainInfoPanel } from '../components/panels/TerrainInfoPanel'
import { HeatmapsPanel } from '../components/panels/HeatmapsPanel'
import { WeatherPanel } from '../components/panels/WeatherPanel'
import { ValidationPanel } from '../components/panels/ValidationPanel'
import { Sidebar } from '../components/layout/Sidebar'
import { TopHeader, type HeaderTab } from '../components/layout/TopHeader'
import { BottomBar } from '../components/layout/BottomBar'
import { useMapControls } from '../hooks/useMapControls'
import { useBattleground } from '../state/battleground'
import { analyzePlan } from '../lib/validate'
import { applyGlobeClipping, clearGlobeClipping } from '../lib/clipping'
import type { SelectionResult } from '../types/selection'
import type { LonLat, PlacedObjective, PlacedRoute, PlacedUnit, ToolMode } from '../types/entities'
import { DEFAULT_LOADOUT, DEFAULT_MOVEMENT, type MovementLoadout, type MovementType } from '../types/movement'

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
  movementType: MovementType
  loadout: MovementLoadout
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
  const [movementType, setMovementType] = useState<MovementType>(DEFAULT_MOVEMENT)
  const [loadout, setLoadout] = useState<MovementLoadout>(DEFAULT_LOADOUT)

  const phase = useBattleground((s) => s.phase)
  const grid = useBattleground((s) => s.grid)
  const night = useBattleground((s) => s.night)
  const monochrome = useBattleground((s) => s.monochrome)
  const generate = useBattleground((s) => s.generate)
  const clearBattleground = useBattleground((s) => s.clear)
  const setPlanAnalysis = useBattleground((s) => s.setPlanAnalysis)

  const planningMode = selection !== null && battlegroundName.trim() !== ''
  // Placement tools/roster need a fully generated battlefield, not just a name+
  // selection -- planningMode alone still gates the toolbar's own "ground already
  // selected, can't redraw" lock (DrawPlanToolbar's select-ground button), which
  // should NOT wait for generation to finish.
  const canPlan = planningMode && phase === 'ready'

  // Re-validate the plan (AI tactics linting) whenever routes or terrain change.
  useEffect(() => {
    setPlanAnalysis(analyzePlan(routes, grid))
  }, [routes, grid, setPlanAnalysis])

  const {
    handleViewerReady,
    getViewer,
    zoomIn,
    zoomOut,
    resetNorth,
    toggleSceneMode,
    toggleSatellite,
    toggleElevation,
    flyToPositions,
    setSelectionZoomCap,
    clearSelectionZoomCap,
    is3D,
    satelliteVisible,
    elevationExaggerated,
  } = useMapControls()

  // Monochrome mode hides satellite imagery entirely (real topo maps are schematic,
  // not desaturated photos) rather than desaturating it -- restores the user's own
  // Satellite preference when monochrome is turned back off. Cesium's globe falls
  // back to a bright blue placeholder appearance when it has no visible imagery
  // layer at all (confirmed visually, not just Globe.baseColor's documented black
  // default), so baseColor alone isn't enough -- explicitly override it here.
  useEffect(() => {
    const viewer = getViewer()
    if (!viewer || viewer.isDestroyed()) return
    const layer = viewer.imageryLayers.get(0)
    if (layer) layer.show = monochrome ? false : satelliteVisible
    viewer.scene.globe.baseColor = monochrome
      ? Cesium.Color.fromCssColorString('#15171a')
      : Cesium.Color.BLACK
  }, [monochrome, satelliteVisible, getViewer])

  const centerLabel = selection
    ? `${selection.stats.centerLatitude.toFixed(4)}° N, ${selection.stats.centerLongitude.toFixed(4)}° E`
    : null

  function handleGenerate() {
    if (!selection) return
    const r = selection.rectangle
    void generate(
      {
        west: Cesium.Math.toDegrees(r.west),
        south: Cesium.Math.toDegrees(r.south),
        east: Cesium.Math.toDegrees(r.east),
        north: Cesium.Math.toDegrees(r.north),
      },
      battlegroundName.trim() || 'Untitled Battleground',
    )
  }

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
    clearBattleground()
    clearSelectionZoomCap()
    const viewer = getViewer()
    if (viewer) clearGlobeClipping(viewer)
    if (planningMode) {
      setBattlegroundName('')
      setUnits([])
      setObjectives([])
      setRoutes([])
      setToolMode('navigate')
    }
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-(--bg) text-(--text)">
      {/* Full-bleed battlefield — every piece of chrome floats above it. */}
      <div className="absolute inset-0">
        <CesiumGlobe
          armed={toolMode === 'select-ground'}
          resetToken={resetToken}
          onSelectionFinalize={(result) => {
            setSelection(result)
            setSelectionZoomCap(result.rectangle)
            const viewer = getViewer()
            if (viewer) applyGlobeClipping(viewer, result.rectangle)
            setToolMode('navigate')
            if (battlegroundName.trim() === '') setNameEditSignal((t) => t + 1)
          }}
          onViewerReady={handleViewerReady}
          toolMode={toolMode}
          units={units}
          objectives={objectives}
          routes={routes}
          movementType={movementType}
          loadout={loadout}
          onPlace={handlePlace}
          onRouteComplete={handleRouteComplete}
          onRouteDrawingChange={setIsDrawingRoute}
        />
      </div>

      {night && <div className="pointer-events-none absolute inset-0 z-10 bg-[#0a1026]/40" />}

      <Sidebar />

      <div className="absolute top-4 right-4 left-60 z-30">
        <TopHeader
          activeTab={activeTab}
          onTabChange={setActiveTab}
          centerLabel={centerLabel}
          name={battlegroundName}
          onNameChange={handleNameChange}
          autoEditSignal={nameEditSignal}
          canName={selection !== null}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between pt-24 pr-4 pb-30 pl-60">
            <div className="flex items-start justify-between gap-3">
              <div className="pointer-events-auto">
                {canPlan && (
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
                {selection === null && <GroundSearchPanel getViewer={getViewer} />}
              </div>
              <div className="pointer-events-auto flex flex-col gap-3">
                {activeTab === 'layers' && (
                  <>
                    <DrawPlanToolbar
                      toolMode={toolMode}
                      onSetToolMode={setToolMode}
                      planningMode={planningMode}
                      battlefieldReady={phase === 'ready'}
                    />
                    {canPlan && (
                      <MovementModePanel
                        movementType={movementType}
                        onMovementTypeChange={setMovementType}
                        loadout={loadout}
                        onLoadoutChange={setLoadout}
                        active={toolMode === 'draw-route'}
                      />
                    )}
                    <TerrainLayersPanel
                      satelliteVisible={satelliteVisible}
                      onToggleSatellite={toggleSatellite}
                      elevationExaggerated={elevationExaggerated}
                      onToggleElevation={toggleElevation}
                    />
                  </>
                )}
                {activeTab === 'heatmaps' && <HeatmapsPanel />}
                {activeTab === 'weather' && <WeatherPanel />}
              </div>
            </div>

            <div className="flex items-end justify-between">
              <div className="pointer-events-auto flex flex-col gap-3">
                {phase === 'ready' ? (
                  <>
                    <ValidationPanel onLocate={flyToPositions} />
                    <TerrainInfoPanel />
                    <button
                      type="button"
                      onClick={handleClear}
                      className="glass w-56 rounded-xl py-1.5 text-xs text-(--text) transition-colors hover:text-(--text-h)"
                    >
                      New ground selection
                    </button>
                  </>
                ) : (
                  <SelectionStatsPanel selection={selection} onClear={handleClear} onGenerate={handleGenerate} />
                )}
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

      <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
        <ReasoningPanel />
      </div>

      {toolMode !== 'navigate' && (
        <div className="pointer-events-none absolute inset-x-60 top-24 z-30 flex justify-center">
          <PlacementHint toolMode={toolMode} isDrawingRoute={isDrawingRoute} />
        </div>
      )}

      <div className="pointer-events-none absolute right-4 bottom-4 left-60 z-30">
        <BottomBar canRunSimulation={selection !== null} planName={battlegroundName} />
      </div>
    </div>
  )
}
