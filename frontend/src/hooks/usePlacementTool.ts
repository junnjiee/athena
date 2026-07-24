import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { pickGroundPosition } from '../lib/pickTerrain'
import { findNearestUnit, findNearestObjective } from '../lib/nearestMarker3D'
import type { LonLat, PlaceableMode, PlacedObjective, PlacedUnit, ToolMode } from '../types/entities'

interface Args {
  viewer: Cesium.Viewer | undefined
  mode: ToolMode
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  onSelectUnit: (id: string | null) => void
  onSetToolMode: (mode: ToolMode) => void
  onPlace: (mode: PlaceableMode, position: LonLat) => void
}

function isPlaceableMode(mode: ToolMode): mode is PlaceableMode {
  return mode !== 'navigate' && mode !== 'select-ground' && mode !== 'draw-route'
}

/** Click-to-place tool shared by every simple point-placement mode (sections,
 *  platoons, trenches, objectives). Deliberately does not disable camera
 *  rotate/translate -- a plain click doesn't fight drag-navigation the way the
 *  rectangle tool's drag does -- and deliberately stays armed after each
 *  placement, since a commander typically stamps down several units of the
 *  same type in a row. A click that lands on an *existing* unit/objective
 *  selects it instead of stamping a duplicate on top -- selection takes
 *  priority over placement -- except for trenches, which are dug *inside* a
 *  section/platoon's position on purpose, so overlapping a unit there must
 *  still place rather than select it. */
export function usePlacementTool({ viewer, mode, units, objectives, onSelectUnit, onSetToolMode, onPlace }: Args) {
  const unitsRef = useRef(units)
  const objectivesRef = useRef(objectives)
  const onSelectUnitRef = useRef(onSelectUnit)
  const onSetToolModeRef = useRef(onSetToolMode)
  const onPlaceRef = useRef(onPlace)

  useEffect(() => {
    unitsRef.current = units
  }, [units])
  useEffect(() => {
    objectivesRef.current = objectives
  }, [objectives])
  useEffect(() => {
    onSelectUnitRef.current = onSelectUnit
  }, [onSelectUnit])
  useEffect(() => {
    onSetToolModeRef.current = onSetToolMode
  }, [onSetToolMode])
  useEffect(() => {
    onPlaceRef.current = onPlace
  }, [onPlace])

  useEffect(() => {
    if (!viewer) return
    if (!isPlaceableMode(mode)) return

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    const isTrench = mode === 'place-trench' || mode === 'place-prepared-trench'

    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      if (!isTrench) {
        const nearestUnit = findNearestUnit(viewer, click.position, unitsRef.current)
        if (nearestUnit) {
          onSetToolModeRef.current('navigate')
          onSelectUnitRef.current(nearestUnit.id)
          return
        }
        const nearestObjective = findNearestObjective(viewer, click.position, objectivesRef.current)
        if (nearestObjective) {
          onSetToolModeRef.current('navigate')
          return
        }
      }

      // Terrain-accurate pick: on a hillside the ellipsoid intersection lands
      // meters away from where the cursor visibly points.
      const cartesian = pickGroundPosition(viewer, click.position)
      if (!cartesian) return
      const carto = Cesium.Cartographic.fromCartesian(cartesian, viewer.scene.globe.ellipsoid)
      onPlaceRef.current(mode, {
        longitude: Cesium.Math.toDegrees(carto.longitude),
        latitude: Cesium.Math.toDegrees(carto.latitude),
      })
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return () => handler.destroy()
  }, [viewer, mode])
}
