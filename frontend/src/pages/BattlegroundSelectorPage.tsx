import { useCallback, useEffect, useRef, useState } from 'react'
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
import { DataQualityWarning } from '../components/panels/DataQualityWarning'
import { HeatmapsPanel } from '../components/panels/HeatmapsPanel'
import { WeatherPanel } from '../components/panels/WeatherPanel'
import { MissionTimePanel } from '../components/panels/MissionTimePanel'
import { Sidebar } from '../components/layout/Sidebar'
import { TopHeader, type HeaderTab } from '../components/layout/TopHeader'
import { BottomBar } from '../components/layout/BottomBar'
import { AssistantDock } from '../components/assistant/AssistantDock'
import { useMapControls } from '../hooks/useMapControls'
import { useBattleground, waitForBattlefield } from '../state/battleground'
import { usePlan } from '../state/plan'
import { useMission } from '../state/mission'
import { registerAssistantHost } from '../assistant/bridge'
import { defaultLoadout, useSettings } from '../state/settings'
import { analyzePlan } from '../lib/validate'
import { toMGRS } from '../lib/coords'
import { savePlan, updatePlan } from '../lib/api'
import {
  computeRectangleStats,
  flyToSelectionPreview,
  MAX_SELECTION_EXTENT_METERS,
} from '../lib/selectionGeometry'
import { photoSource } from '../lib/photoTiles'
import { TileStatsHud } from '../components/panels/TileStatsHud'
import { XRayToggle } from '../components/panels/XRayToggle'
import { applyGlobeClipping, clearGlobeClipping } from '../lib/clipping'
import type { SelectionResult } from '../types/selection'
import type { LonLat, PlaceableMode, ToolMode } from '../types/entities'
import type { MovementLoadout, MovementType } from '../types/movement'

export function BattlegroundSelectorPage() {
  const [toolMode, setToolMode] = useState<ToolMode>('navigate')
  // A loaded plan's meta/grid/features are already restored into the store by
  // loadSaved() before this page mounts -- synthesize a matching `selection`
  // (page-local, drives planningMode/canPlan) from its bbox so the roster
  // panel and planning tools unlock immediately instead of asking to redraw
  // a selection over terrain that's already generated.
  const [selection, setSelection] = useState<SelectionResult | null>(() => {
    const loadedMeta = useBattleground.getState().meta
    if (!loadedMeta) return null
    const rectangle = Cesium.Rectangle.fromDegrees(
      loadedMeta.bbox.west,
      loadedMeta.bbox.south,
      loadedMeta.bbox.east,
      loadedMeta.bbox.north,
    )
    return { rectangle, stats: computeRectangleStats(rectangle) }
  })
  const [resetToken, setResetToken] = useState(0)
  const [activeTab, setActiveTab] = useState<HeaderTab>('layers')
  const [nameEditSignal, setNameEditSignal] = useState(0)
  const [isDrawingRoute, setIsDrawingRoute] = useState(false)
  // Seeded from saved preferences (Settings page) rather than the module-level
  // constants, then owned locally so the movement panel can override per route.
  const [movementType, setMovementType] = useState<MovementType>(
    () => useSettings.getState().defaultMovementType,
  )
  const [loadout, setLoadout] = useState<MovementLoadout>(() => defaultLoadout())
  const [viewMode, setViewMode] = useState<ViewMode>('globe')
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const phase = useBattleground((s) => s.phase)
  const grid = useBattleground((s) => s.grid)
  const features = useBattleground((s) => s.features)
  const meta = useBattleground((s) => s.meta)
  const night = useBattleground((s) => s.night)
  const generate = useBattleground((s) => s.generate)
  const clearBattleground = useBattleground((s) => s.clear)
  const setPlanAnalysis = useBattleground((s) => s.setPlanAnalysis)


  const battlegroundName = usePlan((s) => s.planName)
  const setBattlegroundName = usePlan((s) => s.setPlanName)
  const units = usePlan((s) => s.units)
  const objectives = usePlan((s) => s.objectives)
  const routes = usePlan((s) => s.routes)
  const placeElement = usePlan((s) => s.place)
  const addRoute = usePlan((s) => s.addRoute)
  const moveUnit = usePlan((s) => s.moveUnit)
  const moveObjective = usePlan((s) => s.moveObjective)
  const rotateUnit = usePlan((s) => s.rotateUnit)
  const deleteUnit = usePlan((s) => s.deleteUnit)
  const deleteObjective = usePlan((s) => s.deleteObjective)
  const deleteRoute = usePlan((s) => s.deleteRoute)
  const clearPlan = usePlan((s) => s.clearPlan)

  const showTopo = viewMode === 'topo' && phase === 'ready' && grid !== null
  const photoAvailable = photoSource() !== null
  const showHud = new URLSearchParams(window.location.search).has('hud')

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

  // Apply the operator's night-overlay preference each time a battlefield
  // becomes ready. Keyed on the reveal token rather than `phase` so re-running
  // the pipeline over new ground re-applies it, while a manual toggle mid-
  // session isn't stomped on the next unrelated render.
  const revealToken = useBattleground((s) => s.revealToken)
  useEffect(() => {
    if (revealToken === 0) return
    useBattleground.getState().setNight(useSettings.getState().nightByDefault)
  }, [revealToken])

  // Escape deselects, mirroring the Escape-cancels convention already used by
  // both route-drawing surfaces (useRouteDrawing.ts, TopoPlanOverlay.tsx).
  // Delete/Backspace removes the selection outright -- guarded against firing
  // while focus is in a text field (e.g. renaming the battleground), where
  // Backspace is just normal text editing, not a delete-element shortcut.
  useEffect(() => {
    if (!selectedUnitId) return
    const id = selectedUnitId
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape') {
        setSelectedUnitId(null)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        usePlan.getState().deleteElement(id)
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

  const useMGRS = useSettings((s) => s.useMGRS)
  const assistantEnabled = useSettings((s) => s.assistantEnabled)

  const centerLabel = !selection
    ? null
    : useMGRS
      ? toMGRS(selection.stats.centerLongitude, selection.stats.centerLatitude)
      : `${selection.stats.centerLatitude.toFixed(5)}, ${selection.stats.centerLongitude.toFixed(5)}`

  /** Shared by the Save Plan button and the assistant's save_plan tool. Reads
   *  the plan straight from the store so a voice-driven save can't race the
   *  page's own render of it. */
  const persistPlan = useCallback(async (name?: string, forceNew = false) => {
    const battleground = useBattleground.getState().meta
    if (!battleground) throw new Error('no battlefield is generated yet')
    const plan = usePlan.getState()
    const resolvedName =
      (name ?? plan.planTitle ?? '').trim() || plan.planName.trim() || 'Untitled Plan'
    const payload = {
      // A plan's own title wins; otherwise it inherits the ground's name.
      name: resolvedName,
      units: plan.units,
      objectives: plan.objectives,
      routes: plan.routes,
      // The mission window is part of the plan, not a view setting -- without
      // it, loading a saved plan loses the timing and daylight context the
      // Mission Window panel exists to attach.
      hHour: useMission.getState().hHour,
    }

    // Adopt a name the caller supplied (the assistant's save_plan) as the
    // plan's own title. Otherwise the bottom bar keeps showing the old one, and
    // the next manual Update Plan would rename the saved row back.
    if (name !== undefined && resolvedName !== plan.planTitle) {
      usePlan.getState().setPlanTitle(resolvedName)
    }

    // Overwrite the row this drawing came from, unless it has never been saved
    // or the operator explicitly asked to fork it.
    if (plan.savedPlanId && !forceNew) {
      await updatePlan(plan.savedPlanId, payload)
      return plan.savedPlanId
    }

    const id = await savePlan({ battlegroundId: battleground.id, ...payload })
    usePlan.getState().markSaved(id)
    return id
  }, [])

  // The assistant's tools run outside this component, so hand them the
  // imperative capabilities only this page owns (camera, selection rectangle,
  // view mode). Everything else they need is in the stores. `selection` is read
  // through a ref so the handlers stay stable across redraws of the box.
  const selectionRef = useRef(selection)
  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  useEffect(() => {
    return registerAssistantHost({
      async searchGround(query) {
        const viewer = getViewer()
        if (!viewer) throw new Error('the map is still loading')
        const results = await new Cesium.IonGeocoderService({ scene: viewer.scene }).geocode(query)
        // A geocoder hit is either a point or a bounding rectangle; both reduce
        // to one cartographic centre for the assistant's purposes.
        const hits = results.map((result) => {
          const center =
            result.destination instanceof Cesium.Rectangle
              ? Cesium.Rectangle.center(result.destination)
              : Cesium.Cartographic.fromCartesian(result.destination)
          return {
            name: result.displayName,
            longitude: Cesium.Math.toDegrees(center.longitude),
            latitude: Cesium.Math.toDegrees(center.latitude),
          }
        })
        if (results.length > 0) viewer.camera.flyTo({ destination: results[0].destination })
        return hits
      },

      selectArea(longitude, latitude, sizeMeters) {
        const half = Math.min(Math.max(sizeMeters, 50), MAX_SELECTION_EXTENT_METERS) / 2
        const metersPerDegreeLat = 111_320
        const metersPerDegreeLon = metersPerDegreeLat * Math.cos((latitude * Math.PI) / 180)
        const rectangle = Cesium.Rectangle.fromDegrees(
          longitude - half / metersPerDegreeLon,
          latitude - half / metersPerDegreeLat,
          longitude + half / metersPerDegreeLon,
          latitude + half / metersPerDegreeLat,
        )
        const stats = computeRectangleStats(rectangle)
        // Write the ref synchronously, not just React state. The assistant
        // chains search_ground -> select_area -> generate_battleground inside a
        // single turn, and generateBattleground reads selectionRef immediately;
        // waiting for the post-render effect would have it generate the
        // previous AO, or refuse as if no ground were selected.
        selectionRef.current = { rectangle, stats }
        setSelection({ rectangle, stats })
        setSelectionZoomCap(rectangle)
        const viewer = getViewer()
        if (viewer) {
          applyGlobeClipping(viewer, rectangle)
          flyToSelectionPreview(viewer, rectangle)
        }
        setToolMode('navigate')
        return { widthMeters: stats.widthMeters, heightMeters: stats.heightMeters }
      },

      async generateBattleground(name) {
        const current = selectionRef.current
        if (!current) throw new Error('no ground is selected yet — select an area first')
        // Drawings are anchored to the ground they were placed on. Regenerating
        // over a different area would leave them at coordinates that no longer
        // correspond to the new grid, so analysis and saves would mix the two.
        usePlan.getState().clearDrawing()
        usePlan.getState().setPlanName(name)
        const r = current.rectangle
        await useBattleground.getState().generate(
          {
            west: Cesium.Math.toDegrees(r.west),
            south: Cesium.Math.toDegrees(r.south),
            east: Cesium.Math.toDegrees(r.east),
            north: Cesium.Math.toDegrees(r.north),
          },
          name,
        )
        await waitForBattlefield()
      },

      setViewMode,
      flyTo: flyToPositions,
      savePlan: persistPlan,
    })
  }, [getViewer, setSelectionZoomCap, flyToPositions, persistPlan])

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

  async function handleSavePlan(forceNew = false) {
    if (!meta) return
    setSaveState('saving')
    try {
      await persistPlan(undefined, forceNew)
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2400)
    } catch {
      setSaveState('error')
      setTimeout(() => setSaveState('idle'), 2400)
    }
  }

  function handlePlace(mode: PlaceableMode, position: LonLat) {
    placeElement(mode, position)
  }

  function handleSelectUnit(id: string | null) {
    setSelectedUnitId(id)
  }

  function handleDeleteUnit(id: string) {
    deleteUnit(id)
    if (selectedUnitId === id) setSelectedUnitId(null)
  }

  function handleDeleteObjective(id: string) {
    deleteObjective(id)
    if (selectedUnitId === id) setSelectedUnitId(null)
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
      clearPlan()
      // H-hour belongs to the plan being abandoned, not to the next one.
      useMission.getState().clearMission()
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
          viewMode={viewMode}
          resetToken={resetToken}
          onSelectionFinalize={(result) => {
            setSelection(result)
            setSelectionZoomCap(result.rectangle)
            const viewer = getViewer()
            if (viewer) applyGlobeClipping(viewer, result.rectangle)
            setToolMode('navigate')
            if (battlegroundName.trim() === '') setNameEditSignal((t) => t + 1)
          }}
          onViewerReady={(viewer) => {
            handleViewerReady(viewer)
            // A loaded plan's `selection` is already populated by mount
            // time (see its useState initializer above) -- since that never goes
            // through onSelectionFinalize below, apply the same clipping/zoom-cap
            // here once the viewer exists. No-op for a fresh live-drag session,
            // where `selection` is still null here.
            //
            // Camera framing is NOT done here -- BattlefieldController's
            // "cinematic reveal" already flies the camera to the battlefield
            // whenever `revealToken` bumps (which loadSaved() does too), so a
            // second fly-to here would just race it. It used to: both calls
            // fired, and BattlefieldController's -- unfixed at the time -- always
            // won, landing the camera within single-digit metres of the real
            // ground on a small AO (ellipsoid-height-0 anchor, not the AO's real
            // elevation) and rendering a blank globe. Fixed at the source instead.
            if (selection) {
              applyGlobeClipping(viewer, selection.rectangle)
              setSelectionZoomCap(selection.rectangle)
            }
          }}
          toolMode={toolMode}
          units={units}
          objectives={objectives}
          routes={routes}
          movementType={movementType}
          loadout={loadout}
          selectedUnitId={selectedUnitId}
          onSelectUnit={handleSelectUnit}
          onMoveUnit={moveUnit}
          onMoveObjective={moveObjective}
          onRotateUnit={rotateUnit}
          onSetToolMode={setToolMode}
          onPlace={handlePlace}
          onRouteComplete={addRoute}
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
          onMoveUnit={moveUnit}
          onMoveObjective={moveObjective}
          onRotateUnit={rotateUnit}
          onSetToolMode={setToolMode}
          onPlace={handlePlace}
          onRouteComplete={addRoute}
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
                    onDeleteRoute={deleteRoute}
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
                  photoActive={viewMode === 'photo'}
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
                {activeTab === 'time' && <MissionTimePanel />}
              </div>
            </div>

            <div className="pointer-events-none absolute right-4 bottom-30 left-60 flex items-end justify-between">
              <div className="pointer-events-auto flex max-h-[calc(100vh-13.5rem)] flex-col gap-3 overflow-y-auto">
                {phase === 'ready' ? (
                  <>
                    <DataQualityWarning />
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
                {showHud && <TileStatsHud />}
                {viewMode === 'photo' && <XRayToggle />}
                {assistantEnabled && <AssistantDock />}
                <ViewModeToggle
                  mode={viewMode}
                  onChange={setViewMode}
                  disabled={phase !== 'ready'}
                  photoAvailable={photoAvailable}
                />
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
          planReady={phase === 'ready'}
          planName={battlegroundName}
          onSavePlan={() => void handleSavePlan(false)}
          onSaveAsNew={() => void handleSavePlan(true)}
          saveState={saveState}
        />
      </div>

    </div>
  )
}
