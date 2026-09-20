import { useEffect } from 'react'
import * as Cesium from 'cesium'
import { ACCENT_HEX } from '../lib/colors'
import type { RoadGraph } from '../types/routeStudy'

/** Draws the hovered and the selected road over the black network so the
 *  operator can see which road a click took, or is about to take. Two roads at
 *  most, so entities are fine here where the full network needed a primitive. */
export function useRoadHighlightEntities({
  viewer,
  graph,
  hoveredWayId,
  selectedWayId,
}: {
  viewer: Cesium.Viewer | undefined
  graph: RoadGraph | null
  hoveredWayId: number | null
  selectedWayId: number | null
}) {
  useEffect(() => {
    if (!viewer || !graph) return
    const layers: { wayId: number | null; color: Cesium.Color; width: number }[] = [
      { wayId: hoveredWayId === selectedWayId ? null : hoveredWayId, color: Cesium.Color.WHITE.withAlpha(0.7), width: 6 },
      { wayId: selectedWayId, color: Cesium.Color.fromCssColorString(ACCENT_HEX).withAlpha(0.95), width: 7 },
    ]
    const entities = layers.flatMap(({ wayId, color, width }) => {
      if (wayId === null) return []
      return graph.edges
        .filter((edge) => edge.wayId === wayId && edge.points.length >= 2)
        .map((edge) => viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(edge.points.flat()),
            width,
            material: edge.destroyed
              ? new Cesium.PolylineDashMaterialProperty({ color, dashLength: 12 })
              : color,
            clampToGround: true,
          },
        }))
    })
    return () => {
      if (viewer.isDestroyed()) return
      for (const entity of entities) viewer.entities.remove(entity)
    }
  }, [viewer, graph, hoveredWayId, selectedWayId])
}
