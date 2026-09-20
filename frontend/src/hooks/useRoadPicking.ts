import { useEffect, useMemo, useRef } from 'react'
import * as Cesium from 'cesium'
import { pickGroundPosition } from '../lib/pickTerrain'
import { buildRoadIndex, nearestRoad, type RoadHit } from '../lib/roadIndex'
import type { RoadGraph } from '../types/routeStudy'

/** How far from a road, in screen pixels, a click or hover still counts. */
const PICK_RADIUS_PX = 9

interface Args {
  viewer: Cesium.Viewer | undefined
  graph: RoadGraph | null
  active: boolean
  onHover: (wayId: number | null) => void
  onSelect: (hit: RoadHit | null) => void
}

/** Ground metres under one screen pixel at the cursor, for a straight-down or
 *  gently tilted camera. Exact enough for a pick radius. */
function metersPerPixel(viewer: Cesium.Viewer, ground: Cesium.Cartesian3): number {
  const distance = Cesium.Cartesian3.distance(viewer.camera.positionWC, ground)
  const frustum = viewer.camera.frustum as Cesium.PerspectiveFrustum
  const fovy = frustum.fovy ?? Math.PI / 3
  return (2 * distance * Math.tan(fovy / 2)) / viewer.scene.canvas.clientHeight
}

/** Click a road on the map to select it; hover to preview which one a click
 *  would take. The road register used to be a list of thousands of rows; the
 *  map already draws every one of them, so the map is where they are chosen.
 *
 *  Hover work is deferred to the next frame and the last frame's result is
 *  reused if the cursor has not moved, so dragging the camera does not pay for
 *  a lookup on every mouse event. */
export function useRoadPicking({ viewer, graph, active, onHover, onSelect }: Args) {
  const index = useMemo(() => (graph ? buildRoadIndex(graph) : null), [graph])
  const onHoverRef = useRef(onHover)
  const onSelectRef = useRef(onSelect)
  useEffect(() => { onHoverRef.current = onHover }, [onHover])
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])

  useEffect(() => {
    if (!viewer || !index || !active) return
    const canvas = viewer.scene.canvas
    const handler = new Cesium.ScreenSpaceEventHandler(canvas)

    const hitAt = (position: Cesium.Cartesian2): RoadHit | null => {
      const ground = pickGroundPosition(viewer, position)
      if (!ground) return null
      const carto = Cesium.Cartographic.fromCartesian(ground, viewer.scene.globe.ellipsoid)
      const tolerance = PICK_RADIUS_PX * metersPerPixel(viewer, ground)
      return nearestRoad(index, Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude), tolerance)
    }

    let pending: number | null = null
    let lastHover: number | null = null
    let cursor: Cesium.Cartesian2 | null = null
    const settleHover = () => {
      pending = null
      if (!cursor) return
      const hit = hitAt(cursor)
      const wayId = hit?.wayId ?? null
      canvas.style.cursor = wayId === null ? '' : 'pointer'
      if (wayId !== lastHover) {
        lastHover = wayId
        onHoverRef.current(wayId)
      }
    }

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      cursor = Cesium.Cartesian2.clone(movement.endPosition)
      if (pending === null) pending = requestAnimationFrame(settleHover)
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      onSelectRef.current(hitAt(click.position))
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return () => {
      handler.destroy()
      if (pending !== null) cancelAnimationFrame(pending)
      canvas.style.cursor = ''
      if (lastHover !== null) onHoverRef.current(null)
    }
  }, [viewer, index, active])
}
