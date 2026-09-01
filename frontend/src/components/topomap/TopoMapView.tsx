import { useEffect, useRef, useState } from 'react'
import { drawStyledContours } from '../../lib/contours'
import { elevationRange } from '../../lib/grid'
import { computeContourPlan } from '../../lib/contours'
import { makeTopoProjection } from '../../lib/topoProjection'
import { bearingRadians } from '../../lib/bearing'
import { FRIENDLY_HEX, HOSTILE_HEX, ACCENT_HEX } from '../../lib/colors'
import {
  AREA_SIZE_METERS,
  TRENCH_POINTS_METERS,
  DOT_SPACING_METERS,
  DOT_OFFSET_METERS,
  HANDLE_GAP_METERS,
  halfDepthMeters,
  rotateOffset,
} from '../../lib/tacticalGeometry'
import { TopoPlanOverlay } from './TopoPlanOverlay'
import { currentStep, usePlayback } from '../../state/playback'
import type { ReplayStep } from '../../types/replay'
import type { GridData, OsmFeatures, RoadClass } from '../../types/terrain'
import type {
  LonLat,
  NewRouteInput,
  PlaceableMode,
  PlacedObjective,
  PlacedRoute,
  PlacedUnit,
  ToolMode,
} from '../../types/entities'
import type { MovementLoadout, MovementType } from '../../types/movement'

interface Props {
  grid: GridData
  features: OsmFeatures | null
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  routes: PlacedRoute[]
  toolMode: ToolMode
  movementType: MovementType
  loadout: MovementLoadout
  selectedUnitId: string | null
  onSelectUnit: (id: string | null) => void
  onMoveUnit: (id: string, position: LonLat) => void
  onMoveObjective: (id: string, position: LonLat) => void
  onRotateUnit: (id: string, rotationRadians: number) => void
  onSetToolMode: (mode: ToolMode) => void
  onPlace: (mode: PlaceableMode, position: LonLat) => void
  onRouteComplete: (route: NewRouteInput) => void
  onRouteDrawingChange?: (isDrawing: boolean) => void
}

const INK = '#2b2620'
const PAPER = '#ede4d3'

const ROAD_WIDTH: Record<RoadClass, number> = {
  major: 2.2,
  minor: 1.4,
  track: 1,
  path: 0.75,
}
const ROAD_DASHED: Record<RoadClass, boolean> = {
  major: false,
  minor: false,
  track: true,
  path: true,
}

/** Cesium-independent 2D contour-map rendering of the generated battlefield,
 *  styled like a printed topographic map rather than the 3D satellite scene.
 *  Not just for review: TopoPlanOverlay makes it a full planning surface --
 *  routes can be sketched freehand and units/objectives placed directly on the
 *  paper map, feeding the same plan state as the 3D globe tools. */
export function TopoMapView({
  grid,
  features,
  units,
  objectives,
  routes,
  toolMode,
  movementType,
  loadout,
  selectedUnitId,
  onSelectUnit,
  onMoveUnit,
  onMoveObjective,
  onRotateUnit,
  onSetToolMode,
  onPlace,
  onRouteComplete,
  onRouteDrawingChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const replayStep = usePlayback(currentStep)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // Seed synchronously from layout: ResizeObserver's initial delivery waits for
    // the next rendering opportunity, which leaves the map blank for a frame on
    // mount (and indefinitely in a background tab, where rendering steps pause).
    const rect = container.getBoundingClientRect()
    setSize({ w: rect.width, h: rect.height })
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setSize({ w: width, h: height })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w === 0 || size.h === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.w * dpr
    canvas.height = size.h * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    drawTopoMap(ctx, grid, features, units, objectives, routes, size.w, size.h, selectedUnitId)
    // A run being watched is drawn over the ground it was fought on, alongside
    // the plan that produced it. Seeing the two together is the point: a
    // separate picture of the battlefield is a different battlefield.
    if (replayStep) {
      drawReplayStep(ctx, makeTopoProjection(grid, size.w, size.h), replayStep)
    }
  }, [grid, features, units, objectives, routes, size.w, size.h, selectedUnitId, replayStep])

  return (
    // Inset to the free area rather than full-bleed. The sidebar, header and
    // bottom bar are opaque glass sitting *over* the map, so a full-bleed canvas
    // puts a band of undrawable ground under each of them -- you cannot place a
    // unit or start a route near any edge. Sizing is driven by this element's
    // own box (ResizeObserver below), so the canvas follows.
    <div
      ref={containerRef}
      className="absolute top-20 right-4 bottom-24 left-60 overflow-hidden rounded-2xl border border-(--border)"
    >
      <canvas ref={canvasRef} className="h-full w-full" />
      {size.w > 0 && size.h > 0 && (
        <TopoPlanOverlay
          grid={grid}
          width={size.w}
          height={size.h}
          toolMode={toolMode}
          units={units}
          objectives={objectives}
          movementType={movementType}
          loadout={loadout}
          selectedUnitId={selectedUnitId}
          onSelectUnit={onSelectUnit}
          onMoveUnit={onMoveUnit}
          onMoveObjective={onMoveObjective}
          onRotateUnit={onRotateUnit}
          onSetToolMode={onSetToolMode}
          onPlace={onPlace}
          onRouteComplete={onRouteComplete}
          onDrawingChange={onRouteDrawingChange}
        />
      )}
    </div>
  )
}

/** One tick of a run: tracers first, then soldiers, so nobody is hidden under
 *  their own fire. Casualties stay on the map in grey — where a force died is
 *  the most informative thing on the picture. */
function drawReplayStep(
  ctx: CanvasRenderingContext2D,
  projection: ReturnType<typeof makeTopoProjection>,
  step: ReplayStep,
): void {
  ctx.save()

  ctx.lineWidth = 1
  for (const shot of step.shots) {
    const [fx, fy] = projection.projectCell(
      shot.shooter_position.x,
      shot.shooter_position.y,
    )
    const [tx, ty] = projection.projectCell(
      shot.target_position.x,
      shot.target_position.y,
    )
    ctx.strokeStyle = shot.hit ? 'rgba(255, 215, 160, 0.95)' : 'rgba(255, 215, 160, 0.3)'
    ctx.beginPath()
    ctx.moveTo(fx, fy)
    ctx.lineTo(tx, ty)
    ctx.stroke()
  }

  for (const soldier of step.soldiers) {
    const [ax, ay] = projection.projectCell(soldier.position.x, soldier.position.y)
    const alive = soldier.survival_status === 'alive'
    ctx.fillStyle = alive
      ? soldier.team === 'blue'
        ? FRIENDLY_HEX
        : HOSTILE_HEX
      : 'rgba(150,150,150,0.85)'
    ctx.beginPath()
    ctx.arc(ax, ay, alive ? 3.5 : 2.5, 0, Math.PI * 2)
    ctx.fill()
    if (alive) {
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }

  ctx.restore()
}

function drawTopoMap(
  ctx: CanvasRenderingContext2D,
  grid: GridData,
  features: OsmFeatures | null,
  units: PlacedUnit[],
  objectives: PlacedObjective[],
  routes: PlacedRoute[],
  w: number,
  h: number,
  selectedUnitId: string | null,
): void {
  const projection = makeTopoProjection(grid, w, h)
  const { projectLonLat, projectCell, metersPerPixelX, metersPerPixelY } = projection

  // 1. Background
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, w, h)

  // 2. Faint reference grid (decorative, fixed pixel interval)
  ctx.save()
  ctx.strokeStyle = 'rgba(43, 38, 32, 0.08)'
  ctx.lineWidth = 1
  for (let x = 0; x < w; x += 60) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  for (let y = 0; y < h; y += 60) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
  ctx.restore()

  // 3. Elevation contours
  const [min, max] = elevationRange(grid)
  const plan = computeContourPlan(min, max)
  if (plan) drawStyledContours(ctx, grid, plan.levels, projectCell)

  if (features) {
    // 4. Water (drawn first so roads/buildings sit "on the ground")
    ctx.save()
    for (const area of features.areas) {
      if (area.kind !== 'water' && area.kind !== 'wetland') continue
      ctx.beginPath()
      area.ring.forEach(([lon, lat], i) => {
        const [x, y] = projectLonLat(lon, lat)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.closePath()
      ctx.fillStyle = 'rgba(120, 150, 160, 0.25)'
      ctx.fill()
      ctx.strokeStyle = INK
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ctx.strokeStyle = '#5a7a82'
    ctx.lineWidth = 1.5
    ctx.setLineDash([])
    for (const line of features.waterLines) {
      ctx.beginPath()
      line.points.forEach(([lon, lat], i) => {
        const [x, y] = projectLonLat(lon, lat)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }
    ctx.restore()

    // 5. Roads
    ctx.save()
    ctx.strokeStyle = INK
    for (const road of features.roads) {
      ctx.lineWidth = ROAD_WIDTH[road.roadClass]
      ctx.setLineDash(ROAD_DASHED[road.roadClass] ? [3, 3] : [])
      ctx.beginPath()
      road.points.forEach(([lon, lat], i) => {
        const [x, y] = projectLonLat(lon, lat)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }
    ctx.restore()

    // 6. Buildings
    ctx.save()
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.75
    ctx.fillStyle = 'rgba(43, 38, 32, 0.06)'
    ctx.setLineDash([])
    for (const building of features.buildings) {
      ctx.beginPath()
      building.footprint.forEach(([lon, lat], i) => {
        const [x, y] = projectLonLat(lon, lat)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }

  // 7. Plan overlay (always on top)
  ctx.save()
  ctx.setLineDash([])
  for (const objective of objectives) {
    const [x, y] = projectLonLat(objective.position.longitude, objective.position.latitude)
    const radiusPx = objective.radiusMeters / metersPerPixelX
    ctx.beginPath()
    ctx.arc(x, y, radiusPx, 0, Math.PI * 2)
    ctx.strokeStyle = ACCENT_HEX
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fillStyle = ACCENT_HEX
    ctx.fill()
    drawLabel(ctx, objective.name, x + 8, y)
  }

  for (const route of routes) {
    if (route.points.length < 2) continue
    const color = route.side === 'blue' ? FRIENDLY_HEX : HOSTILE_HEX
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    route.points.forEach((p, i) => {
      const [x, y] = projectLonLat(p.longitude, p.latitude)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.setLineDash([])

    const last = route.points[route.points.length - 1]
    const secondLast = route.points[route.points.length - 2]
    const bearing = bearingRadians(secondLast, last)
    const [lastX, lastY] = projectLonLat(last.longitude, last.latitude)
    drawArrowhead(ctx, lastX, lastY, bearing, color)
  }

  for (const unit of units) {
    const [x, y] = projectLonLat(unit.position.longitude, unit.position.latitude)
    const halfWidthPx = drawUnit(ctx, unit, x, y, metersPerPixelX, metersPerPixelY)
    drawLabel(ctx, `${unit.name} (${unit.typeLabel})`, x + halfWidthPx + 4, y)
  }

  const selectedUnit = selectedUnitId ? units.find((u) => u.id === selectedUnitId) : undefined
  if (selectedUnit) drawSelectionHandle(ctx, selectedUnit, projectLonLat, metersPerPixelX, metersPerPixelY)

  ctx.restore()
}

/** Rotate-handle affordance for the selected unit -- same real-meter offset as
 *  the 3D view's handle (lib/unitHandle.ts), just projected via the topo
 *  view's per-axis meters-per-pixel instead of an ENU frame, so it sits in the
 *  same relative spot in both views. */
function drawSelectionHandle(
  ctx: CanvasRenderingContext2D,
  unit: PlacedUnit,
  projectLonLat: (lon: number, lat: number) => [number, number],
  mppX: number,
  mppY: number,
): void {
  const [cx, cy] = projectLonLat(unit.position.longitude, unit.position.latitude)
  const halfDepth = halfDepthMeters(unit.symbolKind)
  const [east, north] = rotateOffset(0, halfDepth + HANDLE_GAP_METERS, unit.rotationRadians)
  const hx = cx + east / mppX
  const hy = cy - north / mppY

  ctx.save()
  ctx.strokeStyle = ACCENT_HEX
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(hx, hy)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.beginPath()
  ctx.arc(hx, hy, 5, 0, Math.PI * 2)
  ctx.fillStyle = ACCENT_HEX
  ctx.fill()
  ctx.strokeStyle = '#10151c'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
}

/** Draws the unit's ground-truth-sized graphic (real meters -> pixels via the
 *  projection's per-axis scale, so it shrinks/grows correctly as the topo
 *  view's own scale changes) and returns its half-width in pixels, for label
 *  placement. Mirrors useUnitEntities.ts's 3D ground-vector shapes so both
 *  views show the same relative sizes. `unit.rotationRadians` is applied via
 *  ctx.translate+ctx.rotate around the shape's own center -- verified to match
 *  the 3D view's clockwise-from-north rotateOffset convention exactly (canvas
 *  rotate() is a standard rotation matrix, and this app's local coordinate
 *  convention of "north = -y" makes the two mathematically identical, so the
 *  same rotationRadians value looks the same in both views). */
function drawUnit(
  ctx: CanvasRenderingContext2D,
  unit: PlacedUnit,
  cx: number,
  cy: number,
  mppX: number,
  mppY: number,
): number {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(unit.rotationRadians)
  let halfWidthPx: number
  switch (unit.symbolKind) {
    case 'blueSection':
      halfWidthPx = drawAreaRect(ctx, 2, FRIENDLY_HEX, mppX, mppY)
      break
    case 'bluePlatoon':
      halfWidthPx = drawAreaRect(ctx, 3, FRIENDLY_HEX, mppX, mppY)
      break
    case 'redSection':
      halfWidthPx = drawAreaOval(ctx, 2, HOSTILE_HEX, mppX, mppY)
      break
    case 'redPlatoon':
      halfWidthPx = drawAreaOval(ctx, 3, HOSTILE_HEX, mppX, mppY)
      break
    case 'trench':
      halfWidthPx = drawTrench(ctx, false, mppX, mppY)
      break
    case 'preparedTrench':
      halfWidthPx = drawTrench(ctx, true, mppX, mppY)
      break
  }
  ctx.restore()
  return halfWidthPx
}

/** All draw*() helpers below assume the context is already translated to the
 *  unit's center and rotated by its rotationRadians (see drawUnit) -- they draw
 *  in local (0,0)-centered coordinates, where -y is north (matching this app's
 *  established lon/lat -> pixel convention elsewhere in this file). */

function drawDots(ctx: CanvasRenderingContext2D, localY: number, count: 2 | 3, color: string, mppX: number): void {
  const spacingPx = DOT_SPACING_METERS / mppX
  const startX = -((count - 1) * spacingPx) / 2
  ctx.fillStyle = color
  for (let i = 0; i < count; i++) {
    ctx.beginPath()
    ctx.arc(startX + i * spacingPx, localY, 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawAreaOval(ctx: CanvasRenderingContext2D, dots: 2 | 3, color: string, mppX: number, mppY: number): number {
  const { width, depth } = AREA_SIZE_METERS[dots]
  const rx = width / 2 / mppX
  const ry = depth / 2 / mppY
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()
  drawDots(ctx, -ry - DOT_OFFSET_METERS / mppY, dots, color, mppX)
  return rx
}

function drawAreaRect(ctx: CanvasRenderingContext2D, dots: 2 | 3, color: string, mppX: number, mppY: number): number {
  const { width, depth } = AREA_SIZE_METERS[dots]
  const rx = width / 2 / mppX
  const ry = depth / 2 / mppY
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.strokeRect(-rx, -ry, rx * 2, ry * 2)
  ctx.beginPath()
  ctx.moveTo(-rx, -ry)
  ctx.lineTo(rx, ry)
  ctx.moveTo(rx, -ry)
  ctx.lineTo(-rx, ry)
  ctx.stroke()
  drawDots(ctx, -ry - DOT_OFFSET_METERS / mppY, dots, color, mppX)
  return rx
}

function drawTrench(ctx: CanvasRenderingContext2D, prepared: boolean, mppX: number, mppY: number): number {
  ctx.strokeStyle = HOSTILE_HEX
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.setLineDash(prepared ? [4, 3] : [])
  ctx.beginPath()
  TRENCH_POINTS_METERS.forEach(([east, north], i) => {
    const x = east / mppX
    const y = -north / mppY
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()
  ctx.setLineDash([])
  return 10 / mppX
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.font = '11px sans-serif'
  ctx.fillStyle = INK
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
}

function drawArrowhead(ctx: CanvasRenderingContext2D, x: number, y: number, bearing: number, color: string): void {
  const size = 8
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(bearing)
  ctx.beginPath()
  ctx.moveTo(0, -size)
  ctx.lineTo(size * 0.6, size * 0.6)
  ctx.lineTo(-size * 0.6, size * 0.6)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}
