import { useEffect } from 'react'
import * as Cesium from 'cesium'
import { formatRoadCode } from '../lib/roadCodes'
import { roadIdentities, roadLabelPoint } from '../lib/roads'
import type { RoadEdit, RoadGraph } from '../types/routeStudy'

/** Labels only operator-coded roads. The full network remains an unlabelled
 *  black context layer; sparse call signs stay legible above it. */
export function useRoadLabelEntities({
  viewer,
  graph,
  roadEdits,
}: {
  viewer: Cesium.Viewer | undefined
  graph: RoadGraph | null
  roadEdits: Record<string, RoadEdit>
}) {
  useEffect(() => {
    if (!viewer || !graph) return
    const edits = roadEdits
    const entities = roadIdentities(graph).flatMap((road) => {
      const edit = edits[road.id]
      const point = roadLabelPoint(road)
      if (!edit || !point) return []
      return [viewer.entities.add({
        id: `road-label:${road.id}`,
        position: Cesium.Cartesian3.fromDegrees(point[0], point[1]),
        label: {
          text: formatRoadCode(edit),
          font: '600 11px ui-monospace, monospace',
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.78),
          backgroundPadding: new Cesium.Cartesian2(5, 3),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })]
    })

    return () => {
      if (viewer.isDestroyed()) return
      for (const entity of entities) viewer.entities.remove(entity)
    }
  }, [viewer, graph, roadEdits])
}
