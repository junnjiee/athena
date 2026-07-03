import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { FRIENDLY_HEX, HOSTILE_HEX } from '../lib/colors'
import { routeArrowIcon } from '../lib/markerIcons'
import { bearingRadians } from '../lib/bearing'
import type { PlacedRoute } from '../types/entities'

interface Args {
  viewer: Cesium.Viewer | undefined
  routes: PlacedRoute[]
}

interface RouteEntityPair {
  line: Cesium.Entity
  arrow: Cesium.Entity
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

      // Line is uniformly dashed along its whole length -- previously a second,
      // solid (non-dashed) polyline was overlaid on just the final segment to act as
      // an arrowhead, which looked inconsistent (last segment solid, rest dashed).
      // A small rotated arrow billboard at the endpoint reads as a direction marker
      // without breaking the dash pattern.
      const line = viewer.entities.add({
        polyline: {
          positions,
          width: 3,
          material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString(colorHex) }),
          clampToGround: true,
          classificationType: Cesium.ClassificationType.TERRAIN,
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
      entityMapRef.current.set(route.id, { line, arrow })
    }

    for (const [id, pair] of entityMapRef.current) {
      if (!seen.has(id)) {
        viewer.entities.remove(pair.line)
        viewer.entities.remove(pair.arrow)
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
      }
      entityMap.clear()
    }
  }, [viewer])
}
