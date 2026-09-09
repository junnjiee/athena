import { useEffect, useMemo, useRef } from 'react'
import * as Cesium from 'cesium'
import { syncEntities } from '../lib/entitySync'
import { chokeMidpoint } from '../lib/blockForces'
import type { BlockPlan, OrbatUnit, RoadGraph } from '../types/routeStudy'

interface BlockLink {
  id: string
  unitName: string
  from: [number, number]
  to: [number, number]
}

/** A dashed line from each allocated unit to the choke point it was given.
 *
 *  Deliberately straight, and deliberately not labelled with a time. The engine
 *  measures straight-line distance and says nothing about whether the unit gets
 *  there first, so drawing a road route here would imply an arrival claim
 *  nothing in the system supports. */
export function useBlockLinkEntities({
  viewer,
  plan,
  units,
  graph,
}: {
  viewer: Cesium.Viewer | undefined
  plan: BlockPlan | null
  units: OrbatUnit[]
  graph: RoadGraph | null
}) {
  const entityMapRef = useRef(new Map<string, { item: BlockLink; entity: Cesium.Entity }>())

  const links = useMemo<BlockLink[]>(() => {
    if (!plan || !graph) return []
    const byId = new Map(units.map((unit) => [unit.unit_id, unit]))
    const chokes = new Map(plan.corridors.map((block) => [block.corridor_id, block.choke_edge_ids]))

    return plan.allocation.flatMap((entry) => {
      const unit = byId.get(entry.unit_id)
      const target = chokeMidpoint(graph, chokes.get(entry.corridor_id) ?? [])
      if (!unit || !target) return []
      return [
        {
          id: `block-link:${entry.corridor_id}:${entry.unit_id}`,
          unitName: entry.unit_name,
          from: [unit.lon, unit.lat] as [number, number],
          to: target,
        },
      ]
    })
  }, [plan, units, graph])

  useEffect(() => {
    if (!viewer) return
    syncEntities(viewer, links, entityMapRef, (link) => ({
      polyline: {
        positions: [link.from, link.to].map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.85),
          dashLength: 12,
        }),
        clampToGround: true,
        classificationType: Cesium.ClassificationType.BOTH,
        zIndex: 30,
      },
    }))
  }, [viewer, links])

  useEffect(() => {
    const entityMap = entityMapRef.current
    return () => {
      if (!viewer) return
      for (const { entity } of entityMap.values()) viewer.entities.remove(entity)
      entityMap.clear()
    }
  }, [viewer])
}
