import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { FRIENDLY_HEX, HOSTILE_HEX } from '../lib/colors'
import { routeArrowIcon } from '../lib/markerIcons'
import { bearingRadians } from '../lib/bearing'
import { movementLineStyle } from '../lib/movementStyle'
import { MOVEMENT_PROFILES } from '../types/movement'
import type { PlacedRoute } from '../types/entities'

interface Args {
  viewer: Cesium.Viewer | undefined
  routes: PlacedRoute[]
}

interface RouteEntityPair {
  line: Cesium.Entity
  arrow: Cesium.Entity
  label: Cesium.Entity
}

export function useRouteEntities({ viewer, routes }: Args) {
  const entityMapRef = useRef(new Map<string, RouteEntityPair>())

  useEffect(() => {
    if (!viewer) return

    const seen = new Set<string>()
    for (const route of routes) {
      seen.add(route.id)
      if (entityMapRef.current.has(route.id)) continue

      const colorHex = route.side === 'blue' ? FRIENDLY_HEX : HOSTILE_HEX
      const positions = route.points.map((p) => Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude))
      const last = route.points[route.points.length - 1]
      const secondToLast = route.points[route.points.length - 2]
      // Cesium billboard rotation is measured counterclockwise from the default
      // (unrotated) orientation; our arrow icon points "up" (north) at rotation 0,
      // while compass bearing is measured clockwise from north -- negate to convert.
      const rotation = -bearingRadians(secondToLast, last)

      // Line style encodes the movement gait (dotted crawl → glowing rush); it
      // clamps to ground so it reads the same in 2D and 3D.
      const style = movementLineStyle(route.movementType, colorHex)
      const line = viewer.entities.add({
        polyline: {
          positions,
          width: style.width,
          material: style.material,
          clampToGround: true,
          // BOTH so routes also drape the photoreal mesh in RECON mode
          // (behaves exactly like TERRAIN when no tileset is shown)
          classificationType: Cesium.ClassificationType.BOTH,
        },
      })
      const arrow = viewer.entities.add({
        position: positions[positions.length - 1],
        billboard: {
          image: routeArrowIcon(colorHex),
          width: 20,
          height: 20,
          rotation,
          alignedAxis: Cesium.Cartesian3.ZERO,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
      // Gait tag at the route midpoint so the movement order is legible at a glance.
      const midpoint = positions[Math.floor(positions.length / 2)]
      const label = viewer.entities.add({
        position: midpoint,
        label: {
          text: MOVEMENT_PROFILES[route.movementType].label.toUpperCase(),
          font: '600 11px system-ui, sans-serif',
          fillColor: Cesium.Color.fromCssColorString(colorHex),
          showBackground: true,
          backgroundColor: new Cesium.Color(0.04, 0.05, 0.07, 0.8),
          backgroundPadding: new Cesium.Cartesian2(6, 3),
          scaleByDistance: new Cesium.NearFarScalar(500, 1.0, 8000, 0.6),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -8),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
      entityMapRef.current.set(route.id, { line, arrow, label })
    }

    for (const [id, pair] of entityMapRef.current) {
      if (!seen.has(id)) {
        viewer.entities.remove(pair.line)
        viewer.entities.remove(pair.arrow)
        viewer.entities.remove(pair.label)
        entityMapRef.current.delete(id)
      }
    }
  }, [viewer, routes])

  useEffect(() => {
    const entityMap = entityMapRef.current
    return () => {
      if (!viewer) return
      for (const pair of entityMap.values()) {
        viewer.entities.remove(pair.line)
        viewer.entities.remove(pair.arrow)
        viewer.entities.remove(pair.label)
      }
      entityMap.clear()
    }
  }, [viewer])
}
