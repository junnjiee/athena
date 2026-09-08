import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import {
  AlertTriangle,
  Crosshair,
  Flag,
  Loader2,
  Map as MapIcon,
  MapPinned,
  Plus,
  Radar,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { OperationalGlobe } from '../components/globe/OperationalGlobe'
import { MapControls } from '../components/globe/MapControls'
import { Sidebar } from '../components/layout/Sidebar'
import { CorridorEditorPanel } from '../components/panels/CorridorEditorPanel'
import { ReasoningPanel } from '../components/panels/ReasoningPanel'
import { useMapControls } from '../hooks/useMapControls'
import {
  createOperationalArea,
  deleteRouteStudy,
  fetchOperationalArea,
  fetchOperationalGraph,
  listOperationalAreas,
  listRouteStudies,
} from '../lib/api'
import { corridorLines, edgePoints } from '../lib/routeStudy'
import { computeRectangleStats, flyToSelectionPreview } from '../lib/selectionGeometry'
import { subscribeBattleground } from '../lib/socket'
import { useRouteStudy } from '../state/routeStudy'
import type { LonLat } from '../types/entities'
import type { SelectionResult } from '../types/selection'
import type { ProgressEvent, ReasoningStep } from '../types/terrain'
import type {
  Corridor,
  OperationalAreaMeta,
  OperationalToolMode,
  RoadGraph,
  RouteStudySummary,
  StudyMark,
  StudyMarkKind,
} from '../types/routeStudy'

type LibraryState =
  | { kind: 'loading' }
  | { kind: 'ready'; studies: RouteStudySummary[]; areas: OperationalAreaMeta[] }
  | { kind: 'error'; message: string }

type AreaPhase = 'idle' | 'generating'

const OPERATIONAL_MIN_EXTENT_METERS = 10_000
const AREA_TIMEOUT_MS = 180_000

const AREA_STEP_LABELS: [ReasoningStep['id'], string][] = [
  ['roads', 'Downloading mounted road network'],
  ['elevation', 'Sampling operational elevation'],
  ['graph', 'Building routable road graph'],
]

function freshAreaSteps(): ReasoningStep[] {
  return AREA_STEP_LABELS.map(([id, label]) => ({ id, label, status: 'pending' }))
}

function applyAreaProgress(steps: ReasoningStep[], event: ProgressEvent): ReasoningStep[] {
  return steps.map((step) =>
    step.id === event.step
      ? {
          ...step,
          status: event.status === 'start' ? 'active' : event.status === 'done' ? 'done' : 'error',
          detail: event.detail ?? step.detail,
        }
      : step,
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatExtent(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

function rectangleFor(area: OperationalAreaMeta): Cesium.Rectangle {
  return Cesium.Rectangle.fromDegrees(area.bbox.west, area.bbox.south, area.bbox.east, area.bbox.north)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function RouteStudiesPage() {
  const [library, setLibrary] = useState<LibraryState>({ kind: 'loading' })
  const [area, setArea] = useState<OperationalAreaMeta | null>(null)
  const [graph, setGraph] = useState<RoadGraph | null>(null)
  const [selection, setSelection] = useState<SelectionResult | null>(null)
  const [toolMode, setToolMode] = useState<OperationalToolMode>('navigate')
  const [resetToken, setResetToken] = useState(0)
  const [areaName, setAreaName] = useState('')
  const [studyName, setStudyName] = useState('')
  const [areaPhase, setAreaPhase] = useState<AreaPhase>('idle')
  const [areaSteps, setAreaSteps] = useState<ReasoningStep[]>(freshAreaSteps)
  const [areaError, setAreaError] = useState<string | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const areaGenerationRef = useRef(0)
  const areaUnsubscribeRef = useRef<(() => void) | null>(null)

  const phase = useRouteStudy((state) => state.phase)
  const study = useRouteStudy((state) => state.study)
  const marks = useRouteStudy((state) => state.draftMarks)
  const studyError = useRouteStudy((state) => state.error)
  const selectedCorridorId = useRouteStudy((state) => state.selectedCorridorId)
  const addMark = useRouteStudy((state) => state.addMark)
  const removeMark = useRouteStudy((state) => state.removeMark)
  const renameMark = useRouteStudy((state) => state.renameMark)
  const runStudy = useRouteStudy((state) => state.run)
  const loadStudy = useRouteStudy((state) => state.load)
  const resetStudy = useRouteStudy((state) => state.reset)
  const selectCorridor = useRouteStudy((state) => state.selectCorridor)
  const renameCorridor = useRouteStudy((state) => state.renameCorridor)
  const categoriseCorridor = useRouteStudy((state) => state.categoriseCorridor)
  const toggleChoke = useRouteStudy((state) => state.toggleChoke)
  const dismissStudyError = useRouteStudy((state) => state.dismissError)

  const {
    handleViewerReady,
    getViewer,
    zoomIn,
    zoomOut,
    resetNorth,
    toggleSceneMode,
    setSelectionZoomCap,
    clearSelectionZoomCap,
    flyToPositions,
    is3D,
  } = useMapControls()

  const lines = useMemo(
    () => (graph && study ? corridorLines(study.result.corridors, graph) : []),
    [graph, study],
  )

  const refreshLibrary = useCallback(async () => {
    const [studies, areas] = await Promise.all([listRouteStudies(), listOperationalAreas()])
    setLibrary({ kind: 'ready', studies, areas })
    return { studies, areas }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([listRouteStudies(), listOperationalAreas()])
      .then(([studies, areas]) => {
        if (!cancelled) setLibrary({ kind: 'ready', studies, areas })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLibrary({
            kind: 'error',
            message: error instanceof Error ? error.message : 'failed to load operational library',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => () => {
    areaGenerationRef.current++
    areaUnsubscribeRef.current?.()
  }, [])

  function frameArea(nextArea: OperationalAreaMeta) {
    const rectangle = rectangleFor(nextArea)
    setSelectionZoomCap(rectangle)
    const viewer = getViewer()
    if (viewer) flyToSelectionPreview(viewer, rectangle)
  }

  async function openArea(nextArea: OperationalAreaMeta, keepStudy = false) {
    setBusyId(nextArea.id)
    setWorkspaceError(null)
    try {
      const nextGraph = await fetchOperationalGraph(nextArea.id)
      if (!keepStudy) resetStudy()
      setArea(nextArea)
      setGraph(nextGraph)
      const rectangle = rectangleFor(nextArea)
      setSelection({ rectangle, stats: computeRectangleStats(rectangle) })
      setAreaName(nextArea.name)
      if (!keepStudy) setStudyName(`${nextArea.name} Route Study`)
      setToolMode('navigate')
      frameArea(nextArea)
    } catch (error: unknown) {
      setWorkspaceError(error instanceof Error ? error.message : 'failed to load operational area')
    } finally {
      setBusyId(null)
    }
  }

  async function openStudy(summary: RouteStudySummary) {
    setBusyId(summary.id)
    setWorkspaceError(null)
    try {
      await loadStudy(summary.id)
      const loaded = useRouteStudy.getState().study
      if (!loaded || loaded.id !== summary.id) return
      const knownArea = library.kind === 'ready'
        ? library.areas.find((candidate) => candidate.id === loaded.areaId)
        : undefined
      const nextArea = knownArea ?? await fetchOperationalArea(loaded.areaId)
      const nextGraph = await fetchOperationalGraph(nextArea.id)
      setArea(nextArea)
      setGraph(nextGraph)
      const rectangle = rectangleFor(nextArea)
      setSelection({ rectangle, stats: computeRectangleStats(rectangle) })
      setAreaName(nextArea.name)
      setStudyName(loaded.name)
      setToolMode('navigate')
      frameArea(nextArea)
    } catch (error: unknown) {
      setWorkspaceError(error instanceof Error ? error.message : 'failed to load route study')
    } finally {
      setBusyId(null)
    }
  }

  function beginNewArea() {
    areaGenerationRef.current++
    areaUnsubscribeRef.current?.()
    areaUnsubscribeRef.current = null
    resetStudy()
    setArea(null)
    setGraph(null)
    setSelection(null)
    setAreaName('')
    setStudyName('')
    setAreaError(null)
    setWorkspaceError(null)
    setAreaPhase('idle')
    setAreaSteps(freshAreaSteps())
    setResetToken((value) => value + 1)
    clearSelectionZoomCap()
    setToolMode('select-area')
  }

  function handleSelectionFinalize(result: SelectionResult) {
    resetStudy()
    setArea(null)
    setGraph(null)
    setSelection(result)
    setAreaName('New Operational Area')
    setStudyName('New Route Study')
    setToolMode('navigate')
    setSelectionZoomCap(result.rectangle)
  }

  async function waitForOperationalArea(jobId: string, generation: number): Promise<void> {
    const deadline = Date.now() + AREA_TIMEOUT_MS
    while (Date.now() < deadline && generation === areaGenerationRef.current) {
      try {
        const meta = await fetchOperationalArea(jobId)
        const nextGraph = await fetchOperationalGraph(jobId)
        if (generation !== areaGenerationRef.current) return
        setArea(meta)
        setGraph(nextGraph)
        setSelection({ rectangle: rectangleFor(meta), stats: computeRectangleStats(rectangleFor(meta)) })
        setAreaName(meta.name)
        setStudyName(`${meta.name} Route Study`)
        setAreaSteps((steps) => steps.map((step) => ({ ...step, status: 'done' })))
        setAreaPhase('idle')
        areaUnsubscribeRef.current?.()
        areaUnsubscribeRef.current = null
        await refreshLibrary()
        frameArea(meta)
        return
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/not ready/i.test(message)) throw error
      }
      await delay(750)
    }
    if (generation === areaGenerationRef.current) throw new Error('operational area ingest timed out')
  }

  async function generateArea() {
    if (!selection) return
    const generation = ++areaGenerationRef.current
    setAreaPhase('generating')
    setAreaSteps(freshAreaSteps())
    setAreaError(null)
    const rectangle = selection.rectangle
    try {
      const jobId = await createOperationalArea(
        {
          west: Cesium.Math.toDegrees(rectangle.west),
          south: Cesium.Math.toDegrees(rectangle.south),
          east: Cesium.Math.toDegrees(rectangle.east),
          north: Cesium.Math.toDegrees(rectangle.north),
        },
        areaName.trim() || 'Untitled Operational Area',
      )
      areaUnsubscribeRef.current?.()
      areaUnsubscribeRef.current = subscribeBattleground(jobId, {
        onProgress(event) {
          if (generation === areaGenerationRef.current) {
            setAreaSteps((steps) => applyAreaProgress(steps, event))
          }
        },
        onDone(status, error) {
          if (generation === areaGenerationRef.current && status === 'error') {
            setAreaError(error ?? 'operational area ingest failed')
          }
        },
        // Older servers only register tactical jobs on this shared Socket.IO
        // channel. Polling below remains authoritative until their snapshot
        // lookup also recognises operational jobs.
        onError() {},
      })
      await waitForOperationalArea(jobId, generation)
    } catch (error: unknown) {
      if (generation !== areaGenerationRef.current) return
      setAreaError(error instanceof Error ? error.message : 'operational area ingest failed')
      setAreaPhase('idle')
    }
  }

  function handlePlace(mode: 'place-reserve' | 'place-study-objective', position: LonLat) {
    if (!area) return
    const { bbox } = area
    if (
      position.longitude < bbox.west || position.longitude > bbox.east ||
      position.latitude < bbox.south || position.latitude > bbox.north
    ) {
      setWorkspaceError('Place study marks inside the selected operational area.')
      return
    }
    setWorkspaceError(null)
    addMark(mode === 'place-reserve' ? 'reserve' : 'objective', position.longitude, position.latitude)
  }

  async function submitStudy() {
    if (!area) return
    if (marks.reserves.length === 0 || marks.objectives.length === 0) {
      setWorkspaceError('Place at least one enemy reserve and one objective before running the study.')
      return
    }
    if ([...marks.reserves, ...marks.objectives].some((mark) => mark.name.trim() === '')) {
      setWorkspaceError('Every reserve and objective needs a name before running the study.')
      return
    }
    setWorkspaceError(null)
    await runStudy(area.id, studyName.trim() || `${area.name} Route Study`)
    if (useRouteStudy.getState().phase === 'ready') await refreshLibrary()
  }

  async function handleDeleteStudy(summary: RouteStudySummary) {
    if (!window.confirm(`Delete "${summary.name}"? This can't be undone.`)) return
    setBusyId(summary.id)
    try {
      await deleteRouteStudy(summary.id)
      if (study?.id === summary.id) resetStudy()
      await refreshLibrary()
    } catch (error: unknown) {
      setWorkspaceError(error instanceof Error ? error.message : 'failed to delete route study')
    } finally {
      setBusyId(null)
    }
  }

  function locateCorridor(corridor: Corridor) {
    if (!graph) return
    const points = corridor.routes.flatMap((route) => route.edge_ids)
    flyToPositions(edgePoints(points, graph).map(([longitude, latitude]) => ({ longitude, latitude })))
  }

  const extentValid = selection !== null &&
    selection.stats.widthMeters >= OPERATIONAL_MIN_EXTENT_METERS &&
    selection.stats.heightMeters >= OPERATIONAL_MIN_EXTENT_METERS
  const marksDirty = study !== null && JSON.stringify(marks) !== JSON.stringify(study.marks)
  const runningStudy = phase === 'running'

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-(--bg) text-(--text)">
      <div className="absolute inset-0">
        <OperationalGlobe
          toolMode={toolMode}
          resetToken={resetToken}
          marks={marks}
          lines={lines}
          selectedCorridorId={selectedCorridorId}
          onSelectionFinalize={handleSelectionFinalize}
          onViewerReady={handleViewerReady}
          onPlace={handlePlace}
        />
      </div>

      <Sidebar />

      <header className="glass-deep pointer-events-auto absolute top-4 right-4 left-60 z-30 flex h-16 items-center justify-between rounded-xl px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs tracking-wide text-(--text-dim)">
            <Radar className="h-3.5 w-3.5" strokeWidth={1.75} /> ROUTE SUBSTRATE
          </div>
          <div className="truncate text-base text-(--text-h)">
            {study?.name ?? area?.name ?? (selection ? 'New Operational Area' : 'Select operational ground')}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <ToolButton
            title="Select a 10–50 km operational area"
            active={toolMode === 'select-area'}
            onClick={() => setToolMode('select-area')}
          >
            <Crosshair className="h-4 w-4" /> Select area
          </ToolButton>
          <ToolButton
            title="Place enemy reserve"
            active={toolMode === 'place-reserve'}
            disabled={!area}
            onClick={() => setToolMode('place-reserve')}
          >
            <ShieldAlert className="h-4 w-4" /> Reserve
          </ToolButton>
          <ToolButton
            title="Place objective"
            active={toolMode === 'place-study-objective'}
            disabled={!area}
            onClick={() => setToolMode('place-study-objective')}
          >
            <Flag className="h-4 w-4" /> Objective
          </ToolButton>
        </div>
      </header>

      <aside className="glass-deep absolute top-24 bottom-4 left-60 z-20 flex w-72 flex-col rounded-xl p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs tracking-wide text-(--text-dim)">OPERATIONAL LIBRARY</span>
          <button
            type="button"
            onClick={beginNewArea}
            className="flex items-center gap-1 rounded-md bg-(--accent) px-2 py-1 text-xs font-medium text-(--panel-bg-solid) hover:bg-(--accent-hover)"
          >
            <Plus className="h-3.5 w-3.5" /> New area
          </button>
        </div>

        {library.kind === 'loading' && (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-(--text-dim)">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        )}
        {library.kind === 'error' && (
          <div className="rounded-md bg-(--hostile)/10 p-2 text-xs text-(--hostile)">{library.message}</div>
        )}
        {library.kind === 'ready' && (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <LibraryHeading label="AREAS" count={library.areas.length} />
            {library.areas.length === 0 && <EmptyLibraryRow>No ingested areas yet.</EmptyLibraryRow>}
            {library.areas.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busyId !== null}
                onClick={() => void openArea(item)}
                className={`mb-1.5 w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                  area?.id === item.id && !study
                    ? 'border-(--accent-border) bg-(--accent-bg)'
                    : 'border-transparent bg-white/3 hover:bg-white/6'
                }`}
              >
                <div className="flex items-center gap-1.5 text-sm text-(--text-h)">
                  {busyId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPinned className="h-3.5 w-3.5" />}
                  <span className="truncate">{item.name}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-(--text-dim)">
                  {item.nodeCount.toLocaleString()} junctions · {item.edgeCount.toLocaleString()} edges
                </div>
              </button>
            ))}

            <LibraryHeading label="STUDIES" count={library.studies.length} />
            {library.studies.length === 0 && <EmptyLibraryRow>No route studies yet.</EmptyLibraryRow>}
            {library.studies.map((summary) => (
              <div
                key={summary.id}
                className={`group mb-1.5 flex items-center rounded-lg border px-2.5 py-2 transition-colors ${
                  study?.id === summary.id
                    ? 'border-(--accent-border) bg-(--accent-bg)'
                    : 'border-transparent bg-white/3 hover:bg-white/6'
                }`}
              >
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void openStudy(summary)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-1.5 text-sm text-(--text-h)">
                    {busyId === summary.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />}
                    <span className="truncate">{summary.name}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-(--text-dim)">{formatDate(summary.updatedAt)}</div>
                </button>
                <button
                  type="button"
                  title={`Delete ${summary.name}`}
                  onClick={() => void handleDeleteStudy(summary)}
                  className="ml-1 p-1 text-(--text-dim) opacity-0 transition-all hover:text-(--hostile) group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>

      <div className="pointer-events-none absolute top-24 right-4 bottom-20 z-20 flex w-80 flex-col gap-3">
        {selection && !area && (
          <div className="glass pointer-events-auto rounded-xl p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs tracking-wide text-(--text-dim)">
              <MapIcon className="h-3.5 w-3.5" /> AREA SELECTION
            </div>
            <input
              value={areaName}
              maxLength={80}
              onChange={(event) => setAreaName(event.target.value)}
              aria-label="Operational area name"
              className="w-full border-b border-(--border) bg-transparent pb-1 text-sm text-(--text-h) focus:border-(--accent) focus:outline-none"
            />
            <div className="mt-2 flex justify-between text-xs text-(--text-dim)">
              <span>{formatExtent(selection.stats.widthMeters)} wide</span>
              <span>{formatExtent(selection.stats.heightMeters)} high</span>
              <span>{selection.stats.areaKm2.toFixed(0)} km²</span>
            </div>
            {!extentValid && (
              <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Each side must be at least 10 km. Drag a larger area.
              </div>
            )}
            <button
              type="button"
              disabled={!extentValid || areaPhase === 'generating'}
              onClick={() => void generateArea()}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md bg-(--accent) py-2 text-sm font-medium text-(--panel-bg-solid) hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-(--text-dim)"
            >
              {areaPhase === 'generating' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPinned className="h-4 w-4" />}
              Ingest road graph
            </button>
          </div>
        )}

        {area && (
          <MarksPanel
            area={area}
            studyName={studyName}
            onStudyNameChange={setStudyName}
            marks={marks}
            toolMode={toolMode}
            running={runningStudy}
            dirty={marksDirty}
            hasStudy={study !== null}
            onSetToolMode={setToolMode}
            onRenameMark={renameMark}
            onRemoveMark={removeMark}
            onRun={() => void submitStudy()}
            onLocate={(mark) => flyToPositions([{ longitude: mark.lon, latitude: mark.lat }])}
          />
        )}

        {study && (
          <div className="pointer-events-auto min-h-0 flex-1">
            <CorridorEditorPanel
              study={study}
              running={runningStudy}
              selectedCorridorId={selectedCorridorId}
              onSelect={selectCorridor}
              onLocate={locateCorridor}
              onRename={renameCorridor}
              onCategorise={categoriseCorridor}
              onToggleChoke={toggleChoke}
            />
          </div>
        )}
      </div>

      {(workspaceError || studyError) && (
        <div className="glass pointer-events-auto absolute bottom-20 left-[33rem] z-30 flex max-w-md items-start gap-2 rounded-lg border-(--hostile)/30 px-3 py-2 text-xs text-(--hostile)">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{workspaceError ?? studyError}</span>
          <button
            type="button"
            className="ml-auto text-(--text-dim) hover:text-(--text-h)"
            onClick={() => {
              setWorkspaceError(null)
              dismissStudyError()
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="pointer-events-auto absolute right-4 bottom-4 z-30">
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

      {toolMode !== 'navigate' && (
        <div className="glass pointer-events-none absolute bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-lg px-3 py-1.5 text-xs text-(--text-h)">
          {toolMode === 'select-area'
            ? 'Drag a rectangle between 10 and 50 km per side'
            : toolMode === 'place-reserve'
              ? 'Click inside the area to place an enemy reserve'
              : 'Click inside the area to place an objective'}
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
        <ReasoningPanel
          visible={areaPhase === 'generating' || areaError !== null}
          steps={areaSteps}
          error={areaError}
          title="INGESTING OPERATIONAL GROUND"
          errorTitle="Operational ingest failed"
          onDismissError={() => setAreaError(null)}
        />
      </div>
    </div>
  )
}

function ToolButton({
  title,
  active,
  disabled = false,
  onClick,
  children,
}: {
  title: string
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        active ? 'border-(--accent-border) bg-(--accent-bg) text-(--text-h)' : 'border-(--border) text-(--text) hover:text-(--text-h)'
      }`}
    >
      {children}
    </button>
  )
}

function LibraryHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="mt-3 mb-1.5 flex items-center justify-between px-1 text-[10px] tracking-wide text-(--text-dim)">
      <span>{label}</span><span>{count}</span>
    </div>
  )
}

function EmptyLibraryRow({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-(--border) px-2.5 py-2 text-xs text-(--text-dim)">{children}</div>
}

function MarksPanel({
  area,
  studyName,
  onStudyNameChange,
  marks,
  toolMode,
  running,
  dirty,
  hasStudy,
  onSetToolMode,
  onRenameMark,
  onRemoveMark,
  onRun,
  onLocate,
}: {
  area: OperationalAreaMeta
  studyName: string
  onStudyNameChange: (name: string) => void
  marks: { reserves: StudyMark[]; objectives: StudyMark[] }
  toolMode: OperationalToolMode
  running: boolean
  dirty: boolean
  hasStudy: boolean
  onSetToolMode: (mode: OperationalToolMode) => void
  onRenameMark: (kind: StudyMarkKind, id: string, name: string) => void
  onRemoveMark: (kind: StudyMarkKind, id: string) => void
  onRun: () => void
  onLocate: (mark: StudyMark) => void
}) {
  const ready = marks.reserves.length > 0 && marks.objectives.length > 0
  return (
    <div className="glass pointer-events-auto rounded-xl p-3">
      <div className="mb-2 flex items-center justify-between text-xs tracking-wide text-(--text-dim)">
        <span>STUDY MARKS</span>
        <span>{area.edgeCount.toLocaleString()} edges</span>
      </div>
      <input
        value={studyName}
        maxLength={80}
        onChange={(event) => onStudyNameChange(event.target.value)}
        aria-label="Route study name"
        className="mb-2 w-full border-b border-(--border) bg-transparent pb-1 text-sm text-(--text-h) focus:border-(--accent) focus:outline-none"
      />
      <MarkGroup
        label="ENEMY RESERVES"
        kind="reserve"
        marks={marks.reserves}
        active={toolMode === 'place-reserve'}
        onAdd={() => onSetToolMode('place-reserve')}
        onRename={onRenameMark}
        onRemove={onRemoveMark}
        onLocate={onLocate}
      />
      <MarkGroup
        label="OBJECTIVES"
        kind="objective"
        marks={marks.objectives}
        active={toolMode === 'place-study-objective'}
        onAdd={() => onSetToolMode('place-study-objective')}
        onRename={onRenameMark}
        onRemove={onRemoveMark}
        onLocate={onLocate}
      />
      <button
        type="button"
        disabled={!ready || running}
        onClick={onRun}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-(--accent) py-2 text-sm font-medium text-(--panel-bg-solid) hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-(--text-dim)"
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
        {running ? 'Enumerating routes…' : hasStudy ? (dirty ? 'Re-run with marks' : 'Re-run study') : 'Run route study'}
      </button>
    </div>
  )
}

function MarkGroup({
  label,
  kind,
  marks,
  active,
  onAdd,
  onRename,
  onRemove,
  onLocate,
}: {
  label: string
  kind: StudyMarkKind
  marks: StudyMark[]
  active: boolean
  onAdd: () => void
  onRename: (kind: StudyMarkKind, id: string, name: string) => void
  onRemove: (kind: StudyMarkKind, id: string) => void
  onLocate: (mark: StudyMark) => void
}) {
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between px-0.5 text-[10px] tracking-wide text-(--text-dim)">
        <span>{label} ({marks.length})</span>
        <button
          type="button"
          aria-label={`Place ${kind === 'reserve' ? 'enemy reserve' : 'objective'}`}
          onClick={onAdd}
          className={active ? 'text-(--accent)' : 'hover:text-(--text-h)'}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-1 max-h-24 overflow-y-auto">
        {marks.length === 0 && <div className="px-1 py-1 text-[11px] text-(--text-dim)">No marks placed.</div>}
        {marks.map((mark) => (
          <div key={mark.id} className="group flex items-center gap-1 rounded-md px-1 py-1 hover:bg-white/5">
            <span className={`h-1.5 w-1.5 rounded-full ${kind === 'reserve' ? 'bg-(--hostile)' : 'bg-(--accent)'}`} />
            <input
              value={mark.name}
              maxLength={80}
              aria-label={`${kind === 'reserve' ? 'Enemy reserve' : 'Objective'} name`}
              onChange={(event) => onRename(kind, mark.id, event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-xs text-(--text-h) focus:outline-none"
            />
            <button type="button" title="Locate" onClick={() => onLocate(mark)} className="text-(--text-dim) opacity-0 hover:text-(--text-h) group-hover:opacity-100">
              <Crosshair className="h-3 w-3" />
            </button>
            <button type="button" title="Remove" onClick={() => onRemove(kind, mark.id)} className="text-(--text-dim) opacity-0 hover:text-(--hostile) group-hover:opacity-100">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
