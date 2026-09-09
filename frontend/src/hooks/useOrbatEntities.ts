import { useEffect, useMemo, useRef } from 'react'
import * as Cesium from 'cesium'
import { syncEntities } from '../lib/entitySync'
import { orbatUnitIcon } from '../lib/markerIcons'
import { FRIENDLY_HEX } from '../lib/colors'
import { ECHELON_LABEL } from '../lib/orbatTree'
import type { OrbatUnit } from '../types/routeStudy'

interface DisplayUnit extends OrbatUnit {
  id: string
  selected: boolean
  allocated: boolean
}

/** The operator's force list on the ground.
 *
 *  A unit that is not free to be given a blocking task is drawn dimmed rather
 *  than hidden: where a committed platoon is sitting is exactly the thing a
 *  commander needs to see while deciding whether to free it. */
export function useOrbatEntities({
  viewer,
  units,
  selectedUnitId,
  allocatedUnitIds,
}: {
  viewer: Cesium.Viewer | undefined
  units: OrbatUnit[]
  selectedUnitId: string | null
  allocatedUnitIds: Set<string>
}) {
  const entityMapRef = useRef(new Map<string, { item: DisplayUnit; entity: Cesium.Entity }>())

  const displayUnits = useMemo<DisplayUnit[]>(
    () =>
      units.map((unit) => ({
        ...unit,
        id: `orbat-unit:${unit.unit_id}`,
        selected: unit.unit_id === selectedUnitId,
        allocated: allocatedUnitIds.has(unit.unit_id),
      })),
    [units, selectedUnitId, allocatedUnitIds],
  )

  useEffect(() => {
    if (!viewer) return
    syncEntities(viewer, displayUnits, entityMapRef, (unit) => {
      const free = unit.availability === 'uncommitted'
      const hex = unit.allocated ? '#f59e0b' : FRIENDLY_HEX
      const color = Cesium.Color.fromCssColorString(hex)
      return {
        position: Cesium.Cartesian3.fromDegrees(unit.lon, unit.lat),
        billboard: {
          image: orbatUnitIcon(hex, unit.echelon, !free),
          width: unit.selected ? 41 : 34,
          height: unit.selected ? 31 : 26,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `${unit.name}  ·  ${unit.strength}`,
          font: '600 11px system-ui, sans-serif',
          fillColor: free ? color : color.withAlpha(0.55),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#10151c').withAlpha(0.85),
          backgroundPadding: new Cesium.Cartesian2(6, 3),
          pixelOffset: new Cesium.Cartesian2(0, 16),
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        description: `${ECHELON_LABEL[unit.echelon]} · ${unit.availability}`,
      }
    })
  }, [viewer, displayUnits])

  useEffect(() => {
    const entityMap = entityMapRef.current
    return () => {
      if (!viewer) return
      for (const { entity } of entityMap.values()) viewer.entities.remove(entity)
      entityMap.clear()
    }
  }, [viewer])
}
