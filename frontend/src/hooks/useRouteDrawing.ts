import { useCallback, useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import type { ForceSide, LonLat, NewRouteInput, PlacedObjective, PlacedUnit, RouteEndpointRef } from '../types/entities'
import type { MovementLoadout, MovementType } from '../types/movement'
import { FRIENDLY_HEX, HOSTILE_HEX } from '../lib/colors'
import { movementLineStyle } from '../lib/movementStyle'
import { markerWorldPosition, pickGroundPosition } from '../lib/pickTerrain'

interface Args {
  viewer: Cesium.Viewer | undefined
  active: boolean
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  /** gait to stamp on the next drawn route (and to style the live preview) */
  movementType: MovementType
  loadout: MovementLoadout
  onRouteComplete: (route: NewRouteInput) => void
  onDrawingChange?: (isDrawing: boolean) => void
}

interface NearestMarker {
  kind: 'unit' | 'objective'
  id: string
  side?: ForceSide
  position: Cesium.Cartesian3
}

const HIT_RADIUS_PX = 26

function cartesianToLonLat(viewer: Cesium.Viewer, cartesian: Cesium.Cartesian3): LonLat {
  const carto = Cesium.Cartographic.fromCartesian(cartesian, viewer.scene.globe.ellipsoid)
  return { longitude: Cesium.Math.toDegrees(carto.longitude), latitude: Cesium.Math.toDegrees(carto.latitude) }
}

/** Finds the nearest placed unit/objective (by projected screen distance) to a click,
 *  within HIT_RADIUS_PX. Deliberately NOT implemented via `scene.pick`/`drillPick` --
 *  our ground-selection rectangle and objective capture-zone ellipse both use
 *  `classificationType: Cesium.ClassificationType.TERRAIN` (ground-draped
 *  classification primitives), which occupy the Cesium pick framebuffer for their
 *  whole footprint and block picking of billboards rendered on top of them, even
 *  with `disableDepthTestDistance: Infinity` set for normal rendering. A screen-space
 *  nearest-marker distance check sidesteps this entirely and is arguably better UX
 *  anyway (some tolerance clicking a small 28px icon). */
function findNearestMarker(
  viewer: Cesium.Viewer,
  canvasPos: Cesium.Cartesian2,
  units: PlacedUnit[],
  objectives: PlacedObjective[],
): NearestMarker | null {
  let best: (NearestMarker & { distance: number }) | null = null

  // markerWorldPosition lifts each marker to terrain height — the billboards render
  // CLAMP_TO_GROUND, so hit-testing at ellipsoid height 0 would project to the
  // wrong pixel on any hillside and clicks would "miss" the visible icon.
  for (const unit of units) {
    const position = markerWorldPosition(unit.position)
    const screen = viewer.scene.cartesianToCanvasCoordinates(position)
    if (!screen) continue
    const distance = Cesium.Cartesian2.distance(screen, canvasPos)
    if (distance <= HIT_RADIUS_PX && (!best || distance < best.distance)) {
      best = { kind: 'unit', id: unit.id, side: unit.side, position, distance }
    }
  }

  for (const objective of objectives) {
    const position = markerWorldPosition(objective.position)
    const screen = viewer.scene.cartesianToCanvasCoordinates(position)
    if (!screen) continue
    const distance = Cesium.Cartesian2.distance(screen, canvasPos)
    if (distance <= HIT_RADIUS_PX && (!best || distance < best.distance)) {
      best = { kind: 'objective', id: objective.id, position, distance }
    }
  }

  return best
}

/** Movement-order route drawing: must start by clicking an existing unit marker
 *  (inherits that unit's force color), then accumulates waypoints on empty ground,
 *  and finishes either by clicking another unit/objective (snapping the endpoint)
 *  or pressing Enter (finishes early, needs >=2 points) / Escape (discards). */
export function useRouteDrawing({
  viewer,
  active,
  units,
  objectives,
  movementType,
  loadout,
  onRouteComplete,
  onDrawingChange,
}: Args) {
  const stateRef = useRef<'idle' | 'drawing'>('idle')
  const sideRef = useRef<ForceSide | null>(null)
  const startUnitIdRef = useRef<string | null>(null)
  const pointsRef = useRef<Cesium.Cartesian3[]>([])
  const mouseGroundPosRef = useRef<Cesium.Cartesian3 | null>(null)
  const previewEntityRef = useRef<Cesium.Entity | null>(null)
  const onRouteCompleteRef = useRef(onRouteComplete)
  const onDrawingChangeRef = useRef(onDrawingChange)
  const unitsRef = useRef(units)
  const objectivesRef = useRef(objectives)
  const movementTypeRef = useRef(movementType)
  const loadoutRef = useRef(loadout)
  const [isDrawing, setIsDrawing] = useState(false)

  useEffect(() => {
    onRouteCompleteRef.current = onRouteComplete
  }, [onRouteComplete])
  useEffect(() => {
    onDrawingChangeRef.current = onDrawingChange
  }, [onDrawingChange])
  useEffect(() => {
    unitsRef.current = units
  }, [units])
  useEffect(() => {
    objectivesRef.current = objectives
  }, [objectives])
  useEffect(() => {
    movementTypeRef.current = movementType
  }, [movementType])
  useEffect(() => {
    loadoutRef.current = loadout
  }, [loadout])
  useEffect(() => {
    onDrawingChangeRef.current?.(isDrawing)
  }, [isDrawing])

  // Only touch refs and stable setters -- safe to memoize with no dependencies, so
  // effects below can legitimately list these without re-running every render.
  const teardown = useCallback((viewer: Cesium.Viewer) => {
    if (previewEntityRef.current) {
      viewer.entities.remove(previewEntityRef.current)
      previewEntityRef.current = null
    }
    pointsRef.current = []
    mouseGroundPosRef.current = null
    sideRef.current = null
    startUnitIdRef.current = null
    stateRef.current = 'idle'
    setIsDrawing(false)
  }, [])

  const finish = useCallback(
    (viewer: Cesium.Viewer, endRef: RouteEndpointRef | null) => {
      const lonLats = pointsRef.current.map((c) => cartesianToLonLat(viewer, c))
      onRouteCompleteRef.current({
        side: sideRef.current!,
        startUnitId: startUnitIdRef.current!,
        points: lonLats,
        endRef,
        movementType: movementTypeRef.current,
        loadout: loadoutRef.current,
      })
      teardown(viewer)
    },
    [teardown],
  )

  useEffect(() => {
    if (!viewer) return

    if (!active) {
      // This effect's only job when deactivated is syncing local drawing state (and
      // removing the in-progress preview entity) to match -- there's no user-driven
      // callback to do it from instead, since deactivation is caused by a toolMode
      // prop change, not a Cesium input event.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      teardown(viewer)
      return
    }

    function ensurePreviewEntity(side: ForceSide) {
      // Preview matches the committed route's per-gait styling exactly.
      const style = movementLineStyle(movementTypeRef.current, side === 'blue' ? FRIENDLY_HEX : HOSTILE_HEX)
      previewEntityRef.current = viewer!.entities.add({
        polyline: {
          positions: new Cesium.CallbackProperty(() => {
            const pts = [...pointsRef.current]
            if (mouseGroundPosRef.current) pts.push(mouseGroundPosRef.current)
            return pts.length >= 2 ? pts : undefined
          }, false),
          width: style.width,
          material: style.material,
          clampToGround: true,
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
      })
    }

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const nearest = findNearestMarker(viewer, click.position, unitsRef.current, objectivesRef.current)

      if (stateRef.current === 'idle') {
        if (!nearest || nearest.kind !== 'unit') return
        stateRef.current = 'drawing'
        sideRef.current = nearest.side ?? 'blue'
        startUnitIdRef.current = nearest.id
        pointsRef.current = [nearest.position]
        ensurePreviewEntity(sideRef.current)
        setIsDrawing(true)
        return
      }

      if (nearest) {
        pointsRef.current.push(nearest.position)
        finish(viewer, { kind: nearest.kind, id: nearest.id })
        return
      }

      const cartesian = pickGroundPosition(viewer, click.position)
      if (cartesian) pointsRef.current.push(cartesian)
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (stateRef.current !== 'drawing') return
      mouseGroundPosRef.current = pickGroundPosition(viewer, movement.endPosition) ?? null
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    return () => {
      handler.destroy()
      teardown(viewer)
    }
  }, [viewer, active, teardown, finish])

  useEffect(() => {
    if (!isDrawing || !viewer) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        if (pointsRef.current.length >= 2) finish(viewer!, null)
        else teardown(viewer!)
      } else if (e.key === 'Escape') {
        teardown(viewer!)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isDrawing, viewer, teardown, finish])
}
