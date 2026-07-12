import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { pickGroundPosition } from '../lib/pickTerrain'
import type { LonLat, ToolMode } from '../types/entities'

type PlaceableMode = 'place-blue' | 'place-red' | 'place-objective'

interface Args {
  viewer: Cesium.Viewer | undefined
  mode: ToolMode
  onPlace: (mode: PlaceableMode, position: LonLat) => void
}

function isPlaceableMode(mode: ToolMode): mode is PlaceableMode {
  return mode === 'place-blue' || mode === 'place-red' || mode === 'place-objective'
}

/** Click-to-place tool shared by the three simple point-placement modes (units,
 *  threats, objectives). Deliberately does not disable camera rotate/translate --
 *  a plain click doesn't fight drag-navigation the way the rectangle tool's drag
 *  does -- and deliberately stays armed after each placement, since a commander
 *  typically stamps down several units of the same type in a row. */
export function usePlacementTool({ viewer, mode, onPlace }: Args) {
  const onPlaceRef = useRef(onPlace)
  useEffect(() => {
    onPlaceRef.current = onPlace
  }, [onPlace])

  useEffect(() => {
    if (!viewer) return
    if (!isPlaceableMode(mode)) return

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
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
