import { useEffect } from 'react'
import * as Cesium from 'cesium'
import type { RoadGraph } from '../types/routeStudy'

/** Every road the ingest picked up, drawn black over the ground.
 *
 *  This is the operator's evidence that the graph is the ground: a road with no
 *  black line was not detected, and a corridor can never run down it. Without
 *  the layer the only visible roads are the ones a study already chose, which
 *  says nothing about what was missed.
 *
 *  A primitive rather than entities. An operational area runs to tens of
 *  thousands of edges -- 27,644 over Lim Chu Kang -- and an entity apiece would
 *  be that many `Property` evaluations every frame. `GroundPolylinePrimitive`
 *  batches the lot into one draw call and clamps to terrain, which is what the
 *  corridor overlay gets from `clampToGround` but at a scale entities cannot
 *  reach.
 */
export function useRoadNetworkEntities({
  viewer,
  graph,
}: {
  viewer: Cesium.Viewer | undefined
  graph: RoadGraph | null
}) {
  useEffect(() => {
    if (!viewer || !graph) return

    const instances = graph.edges.flatMap((edge) => {
      // A degenerate edge -- one point, or the same point twice -- has no line
      // to draw and GroundPolylineGeometry throws on it rather than ignoring it.
      const flat = edge.points.flat()
      if (edge.points.length < 2) return []
      return [
        new Cesium.GeometryInstance({
          geometry: new Cesium.GroundPolylineGeometry({
            positions: Cesium.Cartesian3.fromDegreesArray(flat),
            width: 1.5,
          }),
          id: edge.id,
        }),
      ]
    })
    if (instances.length === 0) return

    const primitive = new Cesium.GroundPolylinePrimitive({
      geometryInstances: instances,
      allowPicking: false,
      appearance: new Cesium.PolylineMaterialAppearance({
        material: Cesium.Material.fromType('Color', {
          color: Cesium.Color.BLACK.withAlpha(0.8),
        }),
      }),
    })
    viewer.scene.primitives.add(primitive)

    return () => {
      // Cesium destroys the primitive on removal; guard the double-invoke that
      // StrictMode's mount/unmount/remount would otherwise turn into a throw.
      if (!viewer.isDestroyed() && !primitive.isDestroyed()) {
        viewer.scene.primitives.remove(primitive)
      }
    }
  }, [viewer, graph])
}
