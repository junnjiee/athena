import { useEffect, useMemo, useRef } from 'react'
import * as Cesium from 'cesium'
import { syncEntities } from '../lib/entitySync'
import { blockInlets, inletTaskPoint } from '../lib/blockForces'
import type { BlockPlan, OrbatUnit, RoadGraph } from '../types/routeStudy'

interface BlockLink {
  id: string
  unitName: string
  from: [number, number]
  to: [number, number]
  fixed: boolean
}

/** A dashed line from each allocated unit to the inlet it was given.
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
    const inlets = new Map(blockInlets(plan).map((block) => [block.inlet_id, block.edge_ids]))
    const points = new Map((plan.block_points ?? []).map((point) => [point.inlet_id, point]))

    return plan.allocation.flatMap((entry) => {
      const unit = byId.get(entry.unit_id)
      const inletId = entry.inlet_id ?? `legacy:${entry.corridor_id}`
      const fixed = points.get(inletId) ?? entry.block_point ?? null
      const target = inletTaskPoint(
        graph,
        inlets.get(inletId) ?? [],
        entry.nearest_point,
        fixed,
      )
      if (!unit || !target) return []
      return [
        {
          id: `block-link:${inletId}:${entry.unit_id}`,
          unitName: entry.unit_name,
          from: [unit.lon, unit.lat] as [number, number],
          to: target,
          fixed: fixed != null,
        },
      ]
    })
  }, [plan, units, graph])

  useEffect(() => {
    if (!viewer) return
    syncEntities(viewer, links, entityMapRef, (link) => ({
      position: link.fixed ? Cesium.Cartesian3.fromDegrees(link.to[0], link.to[1]) : undefined,
      point: link.fixed ? {
        pixelSize: 9,
        color: Cesium.Color.fromCssColorString('#f59e0b'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      } : undefined,
      label: link.fixed ? {
        text: `${link.unitName} BLOCK`,
        font: '10px sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#fbbf24'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -15),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      } : undefined,
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
