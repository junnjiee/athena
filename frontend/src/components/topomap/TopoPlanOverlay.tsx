import { useCallback, useEffect, useMemo, useRef } from 'react'
import { makeTopoProjection } from '../../lib/topoProjection'
import { polylineLength, simplifyPolyline, type XY } from '../../lib/simplify'
import { FRIENDLY_HEX, HOSTILE_HEX, ACCENT_HEX } from '../../lib/colors'
import type {
  ForceSide,
  LonLat,
  NewRouteInput,
  PlacedObjective,
  PlacedUnit,
  ToolMode,
} from '../../types/entities'
import type { MovementLoadout, MovementType } from '../../types/movement'
import type { GridData } from '../../types/terrain'

type PlaceableMode = 'place-blue' | 'place-red' | 'place-objective'

function isPlaceableMode(mode: ToolMode): mode is PlaceableMode {
  return mode === 'place-blue' || mode === 'place-red' || mode === 'place-objective'
}

interface Props {
  grid: GridData
  width: number
  height: number
  toolMode: ToolMode
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  /** gait/loadout to stamp on a sketched route, mirroring the 3D route tool */
  movementType: MovementType
  loadout: MovementLoadout
  onPlace: (mode: PlaceableMode, position: LonLat) => void
  onRouteComplete: (route: NewRouteInput) => void
  onDrawingChange?: (isDrawing: boolean) => void
}

interface TopoMarker {
  kind: 'unit' | 'objective'
  id: string
  side?: ForceSide
  x: number
  y: number
  position: LonLat
}

interface Stroke {
  side: ForceSide
  startUnitId: string
  startPosition: LonLat
  points: XY[]
}

/** Same screen-space marker tolerance as the 3D view's route tool. */
const HIT_RADIUS_PX = 26
/** Don't record a new freehand sample until the pointer has moved this far. */
const MIN_SAMPLE_PX = 3
/** RDP tolerance for committing a sketch -- keeps squiggles squiggly while
 *  dropping the hundreds of near-collinear pointermove samples. */
const SIMPLIFY_PX = 1.5
/** Strokes shorter than this are an accidental click on a unit, not a route. */
const MIN_STROKE_PX = 12
/** Max pointer travel for a placement press to still count as a click. */
const CLICK_SLOP_PX = 5
const SNAP_RING_PX = 12

function markerColor(marker: TopoMarker): string {
  if (marker.kind === 'objective') return ACCENT_HEX
  return marker.side === 'blue' ? FRIENDLY_HEX : HOSTILE_HEX
}

/** Interactive layer over the topo map: freehand route sketching (press-drag from
 *  a unit, release on empty ground or snap onto a unit/objective) and click-to-place
 *  for units/objectives. Commits into the same plan state as the 3D globe tools --
 *  a sketch here is a PlacedRoute everywhere. */
export function TopoPlanOverlay({
  grid,
  width,
  height,
  toolMode,
  units,
  objectives,
  movementType,
  loadout,
  onPlace,
  onRouteComplete,
  onDrawingChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokeRef = useRef<Stroke | null>(null)
  const pressRef = useRef<XY | null>(null)
  const onDrawingChangeRef = useRef(onDrawingChange)

  useEffect(() => {
    onDrawingChangeRef.current = onDrawingChange
  }, [onDrawingChange])

  const projection = useMemo(() => makeTopoProjection(grid, width, height), [grid, width, height])

  const markers = useMemo<TopoMarker[]>(() => {
    const toMarker = (kind: TopoMarker['kind'], id: string, position: LonLat, side?: ForceSide): TopoMarker => {
      const [x, y] = projection.projectLonLat(position.longitude, position.latitude)
      return { kind, id, side, x, y, position }
    }
    return [
      ...units.map((u) => toMarker('unit', u.id, u.position, u.side)),
      ...objectives.map((o) => toMarker('objective', o.id, o.position)),
    ]
  }, [projection, units, objectives])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
  }, [width, height])

  const clearPreview = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }, [])

  // Touches only refs -- safe to list in effects without re-running per render.
  const cancelStroke = useCallback(() => {
    pressRef.current = null
    if (!strokeRef.current) return
    strokeRef.current = null
    onDrawingChangeRef.current?.(false)
    clearPreview()
  }, [clearPreview])

  // Switching tools (or unmounting, e.g. flipping back to the 3D view) mid-sketch
  // discards the in-progress stroke rather than committing a half-drawn route.
  useEffect(() => () => cancelStroke(), [toolMode, cancelStroke])

  useEffect(() => {
    if (toolMode !== 'draw-route') return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') cancelStroke()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toolMode, cancelStroke])

  function nearestMarker(point: XY, kind?: TopoMarker['kind']): TopoMarker | null {
    let best: TopoMarker | null = null
    let bestDistance = HIT_RADIUS_PX
    for (const marker of markers) {
      if (kind && marker.kind !== kind) continue
      const distance = Math.hypot(marker.x - point[0], marker.y - point[1])
      if (distance <= bestDistance) {
        best = marker
        bestDistance = distance
      }
    }
    return best
  }

  function drawSnapRing(ctx: CanvasRenderingContext2D, marker: TopoMarker) {
    ctx.beginPath()
    ctx.arc(marker.x, marker.y, SNAP_RING_PX, 0, Math.PI * 2)
    ctx.strokeStyle = markerColor(marker)
    ctx.lineWidth = 1.5
    ctx.setLineDash([])
    ctx.stroke()
  }

  function drawPreview(cursor: XY) {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const stroke = strokeRef.current
    if (!stroke) {
      // Idle affordance: ring the unit a press here would start sketching from.
      const start = nearestMarker(cursor, 'unit')
      if (start) drawSnapRing(ctx, start)
      return
    }

    ctx.strokeStyle = stroke.side === 'blue' ? FRIENDLY_HEX : HOSTILE_HEX
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    stroke.points.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.lineTo(cursor[0], cursor[1])
    ctx.stroke()

    const snap = nearestMarker(cursor)
    if (snap) drawSnapRing(ctx, snap)
  }

  function localPoint(e: React.PointerEvent<HTMLCanvasElement>): XY {
    const rect = e.currentTarget.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top]
  }

  function finishStroke(release: XY) {
    const stroke = strokeRef.current
    if (!stroke) return
    strokeRef.current = null
    onDrawingChangeRef.current?.(false)
    clearPreview()

    const raw: XY[] = [...stroke.points, release]
    if (polylineLength(raw) < MIN_STROKE_PX) return

    const snap = nearestMarker(release)
    const pixels = simplifyPolyline(snap ? [...stroke.points, [snap.x, snap.y]] : raw, SIMPLIFY_PX)
    // Endpoints carry the exact marker coordinates instead of unprojected pixels,
    // so snapped routes join their unit/objective with no float drift.
    const interior = pixels.slice(1, -1).map(([x, y]): LonLat => {
      const [longitude, latitude] = projection.unprojectXY(x, y)
      return { longitude, latitude }
    })
    const [endX, endY] = pixels[pixels.length - 1]
    const [endLon, endLat] = projection.unprojectXY(endX, endY)
    const points: LonLat[] = [
      stroke.startPosition,
      ...interior,
      snap ? snap.position : { longitude: endLon, latitude: endLat },
    ]

    onRouteComplete({
      side: stroke.side,
      startUnitId: stroke.startUnitId,
      points,
      endRef: snap ? { kind: snap.kind, id: snap.id } : null,
      movementType,
      loadout,
    })
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return
    const point = localPoint(e)

    if (isPlaceableMode(toolMode)) {
      pressRef.current = point
      return
    }
    if (toolMode !== 'draw-route') return

    const start = nearestMarker(point, 'unit')
    if (!start) return
    try {
      // Keeps the drag alive when the pointer leaves the canvas. Throws for
      // synthetic events (console/E2E driving) whose pointerId has no active
      // pointer -- capture is a nicety there, not a requirement.
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    strokeRef.current = {
      side: start.side ?? 'blue',
      startUnitId: start.id,
      startPosition: start.position,
      points: [[start.x, start.y]],
    }
    onDrawingChangeRef.current?.(true)
    drawPreview(point)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const point = localPoint(e)
    const stroke = strokeRef.current
    if (stroke) {
      const last = stroke.points[stroke.points.length - 1]
      if (Math.hypot(point[0] - last[0], point[1] - last[1]) >= MIN_SAMPLE_PX) {
        stroke.points.push(point)
      }
      drawPreview(point)
      return
    }
    if (toolMode === 'draw-route') drawPreview(point)
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const point = localPoint(e)

    if (isPlaceableMode(toolMode)) {
      const press = pressRef.current
      pressRef.current = null
      if (!press || Math.hypot(point[0] - press[0], point[1] - press[1]) > CLICK_SLOP_PX) return
      const [longitude, latitude] = projection.unprojectXY(point[0], point[1])
      onPlace(toolMode, { longitude, latitude })
      return
    }
    finishStroke(point)
  }

  function handlePointerLeave() {
    // Idle hover ring only -- an active stroke has pointer capture and keeps
    // receiving moves outside the canvas.
    if (!strokeRef.current) clearPreview()
  }

  const interactive = toolMode === 'draw-route' || isPlaceableMode(toolMode)

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 h-full w-full ${interactive ? 'cursor-crosshair' : 'pointer-events-none'}`}
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancelStroke}
      onPointerLeave={handlePointerLeave}
    />
  )
}
