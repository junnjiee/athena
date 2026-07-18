import { useEffect, useState } from 'react'
import * as Cesium from 'cesium'
import { CesiumGlobe } from '../components/globe/CesiumGlobe'
import { MapControls } from '../components/globe/MapControls'
import { ViewModeToggle, type ViewMode } from '../components/globe/ViewModeToggle'
import { TopoMapView } from '../components/topomap/TopoMapView'
import { DrawPlanToolbar } from '../components/toolbar/DrawPlanToolbar'
import { TerrainLayersPanel } from '../components/panels/TerrainLayersPanel'
import { SelectionStatsPanel } from '../components/panels/SelectionStatsPanel'
import { PlanRosterPanel } from '../components/panels/PlanRosterPanel'
import { MovementModePanel } from '../components/panels/MovementModePanel'
import { GroundSearchPanel } from '../components/panels/GroundSearchPanel'
import { PlacementHint } from '../components/panels/PlacementHint'
import { ReasoningPanel } from '../components/panels/ReasoningPanel'
import { TerrainInfoPanel } from '../components/panels/TerrainInfoPanel'
import { SimulationExportModal } from '../components/panels/SimulationExportModal'
import { HeatmapsPanel } from '../components/panels/HeatmapsPanel'
import { WeatherPanel } from '../components/panels/WeatherPanel'
import { Sidebar } from '../components/layout/Sidebar'
import { TopHeader, type HeaderTab } from '../components/layout/TopHeader'
import { BottomBar } from '../components/layout/BottomBar'
import { useMapControls } from '../hooks/useMapControls'
import { useBattleground } from '../state/battleground'
import { analyzePlan } from '../lib/validate'
import { toMGRS } from '../lib/coords'
import { applyGlobeClipping, clearGlobeClipping } from '../lib/clipping'
import type { SelectionResult } from '../types/selection'
import type {
  ForceSide,
  LonLat,
  NewRouteInput,
  PlaceableMode,
  PlacedObjective,
  PlacedRoute,
  PlacedUnit,
  SymbolKind,
  ToolMode,
} from '../types/entities'
import { DEFAULT_LOADOUT, DEFAULT_MOVEMENT, type MovementLoadout, type MovementType } from '../types/movement'

const NATO = [
  'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett',
  'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango',
  'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu',
]

/** Every non-objective placeable tool -> the unit fields it stamps down. */
const UNIT_PLACEMENT: Record<
  Exclude<PlaceableMode, 'place-objective'>,
  { side: ForceSide; symbolKind: SymbolKind; typeLabel: string }
> = {
  'place-blue-section': { side: 'blue', symbolKind: 'blueSection', typeLabel: 'Blue Force Section' },
  'place-blue-platoon': { side: 'blue', symbolKind: 'bluePlatoon', typeLabel: 'Blue Force Platoon' },
  'place-red-section': { side: 'red', symbolKind: 'redSection', typeLabel: 'Red Force Section' },
  'place-red-platoon': { side: 'red', symbolKind: 'redPlatoon', typeLabel: 'Red Force Platoon' },
  'place-trench': { side: 'red', symbolKind: 'trench', typeLabel: 'Trench Position' },
  'place-prepared-trench': { side: 'red', symbolKind: 'preparedTrench', typeLabel: 'Prepared Trench' },
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
  const [viewMode, setViewMode] = useState<ViewMode>('globe')
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [showSimulationExport, setShowSimulationExport] = useState(false)

  const phase = useBattleground((s) => s.phase)
  const grid = useBattleground((s) => s.grid)
  const features = useBattleground((s) => s.features)
  const night = useBattleground((s) => s.night)
  const generate = useBattleground((s) => s.generate)
  const clearBattleground = useBattleground((s) => s.clear)
  const setPlanAnalysis = useBattleground((s) => s.setPlanAnalysis)

  const showTopo = viewMode === 'topo' && phase === 'ready' && grid !== null

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

  // Escape deselects, mirroring the Escape-cancels convention already used by
  // both route-drawing surfaces (useRouteDrawing.ts, TopoPlanOverlay.tsx).
  // Delete/Backspace removes the selection outright -- guarded against firing
  // while focus is in a text field (e.g. renaming the battleground), where
  // Backspace is just normal text editing, not a delete-element shortcut.
  useEffect(() => {
    if (!selectedUnitId) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape') {
        setSelectedUnitId(null)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = selectedUnitId
        setUnits((prev) => prev.filter((u) => u.id !== id))
        setRoutes((prev) => prev.filter((r) => r.startUnitId !== id && !(r.endRef?.kind === 'unit' && r.endRef.id === id)))
        setSelectedUnitId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedUnitId])

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

  const centerLabel = selection
    ? toMGRS(selection.stats.centerLongitude, selection.stats.centerLatitude)
    : null

  function handleGenerate() {
    if (!selection) return
    // Planning tools are gated on a non-empty name (planningMode). If the user
    // generates without naming, commit the fallback name to state too — otherwise
    // the battlefield renders but every placement tool stays locked with no clear
    // reason ("Battlefield ready — draw a plan" while the draw tools are disabled).
    const name = battlegroundName.trim() || 'Untitled Battleground'
    if (battlegroundName.trim() === '') setBattlegroundName(name)
    const r = selection.rectangle
    void generate(
      {
        west: Cesium.Math.toDegrees(r.west),
        south: Cesium.Math.toDegrees(r.south),
        east: Cesium.Math.toDegrees(r.east),
        north: Cesium.Math.toDegrees(r.north),
      },
      name,
    )
  }

  function handlePlace(mode: PlaceableMode, position: LonLat) {
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
    const { side, symbolKind, typeLabel } = UNIT_PLACEMENT[mode]
    setUnits((prev) => {
      const sideCount = prev.filter((u) => u.side === side).length
      return [
        ...prev,
        { id: crypto.randomUUID(), side, symbolKind, name: NATO[sideCount % 26], typeLabel, position, rotationRadians: 0 },
      ]
    })
  }

  function handleRouteComplete(input: NewRouteInput) {
    setRoutes((prev) => [...prev, { id: crypto.randomUUID(), ...input }])
  }

  function handleSelectUnit(id: string | null) {
    setSelectedUnitId(id)
  }

  function handleMoveUnit(id: string, position: LonLat) {
    setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, position } : u)))
  }

  function handleMoveObjective(id: string, position: LonLat) {
    setObjectives((prev) => prev.map((o) => (o.id === id ? { ...o, position } : o)))
  }

  function handleRotateUnit(id: string, rotationRadians: number) {
    setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, rotationRadians } : u)))
  }

  function handleDeleteUnit(id: string) {
    setUnits((prev) => prev.filter((u) => u.id !== id))
    setRoutes((prev) => prev.filter((r) => r.startUnitId !== id && !(r.endRef?.kind === 'unit' && r.endRef.id === id)))
    if (selectedUnitId === id) setSelectedUnitId(null)
  }

  function handleDeleteObjective(id: string) {
    setObjectives((prev) => prev.filter((o) => o.id !== id))
    setRoutes((prev) => prev.filter((r) => !(r.endRef?.kind === 'objective' && r.endRef.id === id)))
    if (selectedUnitId === id) setSelectedUnitId(null)
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
      setViewMode('globe')
      setSelectedUnitId(null)
    }
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-(--bg) text-(--text)">
      {/* Full-bleed battlefield — every piece of chrome floats above it. Cesium stays
          mounted (never unmounted) while the topo view is shown, to avoid re-paying
          its Viewer/worldTerrain initialization cost every time the user switches
          back -- visibility:hidden pulls it out of paint/hit-testing instead. */}
      <div className="absolute inset-0" style={{ visibility: showTopo ? 'hidden' : 'visible' }}>
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
          selectedUnitId={selectedUnitId}
          onSelectUnit={handleSelectUnit}
          onMoveUnit={handleMoveUnit}
          onMoveObjective={handleMoveObjective}
          onRotateUnit={handleRotateUnit}
          onSetToolMode={setToolMode}
          onPlace={handlePlace}
          onRouteComplete={handleRouteComplete}
          onRouteDrawingChange={setIsDrawingRoute}
        />
      </div>

      {showTopo && grid && (
        <TopoMapView
          grid={grid}
          features={features}
          units={units}
          objectives={objectives}
          routes={routes}
          toolMode={toolMode}
          movementType={movementType}
          loadout={loadout}
          selectedUnitId={selectedUnitId}
          onSelectUnit={handleSelectUnit}
          onMoveUnit={handleMoveUnit}
          onMoveObjective={handleMoveObjective}
          onRotateUnit={handleRotateUnit}
          onSetToolMode={setToolMode}
          onPlace={handlePlace}
          onRouteComplete={handleRouteComplete}
          onRouteDrawingChange={setIsDrawingRoute}
        />
      )}

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

      {/* Top and bottom rows are independently pinned via absolute positioning
          (rather than flex-col + justify-between) so a tall top row (toolbar +
          movement panel + terrain layers) can never push the bottom row past the
          visible viewport -- justify-between only distributes space when the
          combined content fits; once it doesn't, it degrades to stacking items
          back-to-back from the top, which is exactly what sent TerrainInfoPanel
          sinking off the bottom edge on shorter viewports. */}
      <div className="pointer-events-none absolute inset-0 z-20">
            <div className="pointer-events-none absolute top-24 right-4 left-60 flex items-start justify-between gap-3">
              <div className="pointer-events-auto flex max-h-[calc(100vh-13.5rem)] flex-col gap-3 overflow-y-auto">
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
                {selection === null && (
                  <GroundSearchPanel getViewer={getViewer} toolMode={toolMode} onSetToolMode={setToolMode} />
                )}
                <TerrainLayersPanel
                  satelliteVisible={satelliteVisible}
                  onToggleSatellite={toggleSatellite}
                  elevationExaggerated={elevationExaggerated}
                  onToggleElevation={toggleElevation}
                />
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
                    {canPlan && toolMode === 'draw-route' && (
                      <MovementModePanel
                        movementType={movementType}
                        onMovementTypeChange={setMovementType}
                        loadout={loadout}
                        onLoadoutChange={setLoadout}
                        active={toolMode === 'draw-route'}
                      />
                    )}
                  </>
                )}
                {activeTab === 'heatmaps' && <HeatmapsPanel />}
                {activeTab === 'weather' && <WeatherPanel />}
              </div>
            </div>

            <div className="pointer-events-none absolute right-4 bottom-30 left-60 flex items-end justify-between">
              <div className="pointer-events-auto flex max-h-[calc(100vh-13.5rem)] flex-col gap-3 overflow-y-auto">
                {phase === 'ready' ? (
                  <>
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
              <div className="pointer-events-auto flex flex-col items-end gap-2">
                <ViewModeToggle mode={viewMode} onChange={setViewMode} disabled={phase !== 'ready'} />
                <MapControls
                  is3D={is3D}
                  onResetNorth={resetNorth}
                  onToggleSceneMode={toggleSceneMode}
                  onZoomIn={zoomIn}
                  onZoomOut={zoomOut}
                  toolMode={toolMode}
                  onSetToolMode={setToolMode}
                />
              </div>
            </div>
          </div>

      <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
        <ReasoningPanel />
      </div>

      {toolMode !== 'navigate' && (
        <div className="pointer-events-none absolute inset-x-60 top-24 z-30 flex justify-center">
          <PlacementHint toolMode={toolMode} isDrawingRoute={isDrawingRoute} topo={showTopo} />
        </div>
      )}

      <div className="pointer-events-none absolute right-4 bottom-4 left-60 z-30">
        <BottomBar
          canRunSimulation={phase === 'ready'}
          planName={battlegroundName}
          onRunSimulation={() => setShowSimulationExport(true)}
        />
      </div>

      <SimulationExportModal
        open={showSimulationExport}
        onClose={() => setShowSimulationExport(false)}
        units={units}
        objectives={objectives}
        routes={routes}
      />
    </div>
  )
}
