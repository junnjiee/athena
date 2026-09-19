import { useEffect, useMemo, useRef } from 'react'
import * as Cesium from 'cesium'
import { syncEntities } from '../lib/entitySync'
import { blockInlets, inletTaskPoint } from '../lib/blockForces'
import { BLOCK_FORCE_SYMBOL, blockForceSymbol } from '../lib/markerIcons'
import type { BlockPlan, Echelon, OrbatUnit, RoadGraph } from '../types/routeStudy'

const BLOCK_HEX = '#f59e0b'

interface BlockLink {
  id: string
  unitName: string
  echelon: Echelon
  /** The unit's parent in the ORBAT, when it has one. */
  higherFormation: string | null
  from: [number, number]
  to: [number, number]
  fixed: boolean
}

/** A dashed line from each allocated unit to the inlet it was given, and the
 *  block-force staff aid standing at that inlet.
 *
 *  The link is deliberately straight, and deliberately not labelled with a
 *  time. The engine measures straight-line distance and says nothing about
 *  whether the unit gets there first, so drawing a road route here would imply
 *  an arrival claim nothing in the system supports.
 *
 *  The staff aid is drawn as soon as a unit is allocated, at the engine's
 *  nearest inlet point, and moves to the exact block point once the operator
 *  sets one. Until then its staff is dashed: the task exists, the spot is
 *  provisional. */
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
      const parent = unit.parent_id != null ? byId.get(unit.parent_id) : undefined
      return [
        {
          id: `block-link:${inletId}:${entry.unit_id}`,
          unitName: entry.unit_name,
          echelon: unit.echelon,
          higherFormation: parent?.name ?? null,
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
      position: Cesium.Cartesian3.fromDegrees(link.to[0], link.to[1]),
      billboard: {
        image: blockForceSymbol({
          colorHex: BLOCK_HEX,
          echelon: link.echelon,
          designation: link.unitName,
          higherFormation: link.higherFormation,
          provisional: !link.fixed,
        }),
        width: BLOCK_FORCE_SYMBOL.width,
        height: BLOCK_FORCE_SYMBOL.height,
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(-BLOCK_FORCE_SYMBOL.foot, BLOCK_FORCE_SYMBOL.foot),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      polyline: {
        positions: [link.from, link.to].map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString(BLOCK_HEX).withAlpha(0.85),
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
