import { useEffect, useRef, useState } from 'react'
import { drawStyledContours } from '../../lib/contours'
import { elevationRange } from '../../lib/grid'
import { computeContourPlan } from '../../lib/contours'
import { makeTopoProjection } from '../../lib/topoProjection'
import { bearingRadians } from '../../lib/bearing'
import { FRIENDLY_HEX, HOSTILE_HEX, ACCENT_HEX } from '../../lib/colors'
import type { GridData, OsmFeatures, RoadClass } from '../../types/terrain'
import type { PlacedObjective, PlacedRoute, PlacedUnit } from '../../types/entities'

interface Props {
  grid: GridData
  features: OsmFeatures | null
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  routes: PlacedRoute[]
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

/** Read-only, Cesium-independent 2D contour-map rendering of the generated
 *  battlefield -- an alternate way to review terrain + plan, styled like a printed
 *  topographic map rather than the 3D satellite scene. */
export function TopoMapView({ grid, features, units, objectives, routes }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
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
    drawTopoMap(ctx, grid, features, units, objectives, routes, size.w, size.h)
  }, [grid, features, units, objectives, routes, size.w, size.h])

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  )
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
): void {
  const projection = makeTopoProjection(grid, w, h)
  const { projectLonLat, projectCell, metersPerPixelX } = projection

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
    const color = unit.side === 'blue' ? FRIENDLY_HEX : HOSTILE_HEX
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(Math.PI / 4)
    ctx.fillStyle = color
    ctx.strokeStyle = INK
    ctx.lineWidth = 1
    ctx.fillRect(-5, -5, 10, 10)
    ctx.strokeRect(-5, -5, 10, 10)
    ctx.restore()
    drawLabel(ctx, `${unit.name} (${unit.typeLabel})`, x + 8, y)
  }
  ctx.restore()
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
