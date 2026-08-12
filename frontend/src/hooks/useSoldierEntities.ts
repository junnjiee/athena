import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { FRIENDLY_HEX, HOSTILE_HEX } from '../lib/colors'
import type { BBoxDeg } from '../types/terrain'
import type { ReplayLog } from '../types/replayLog'

interface Args {
  viewer: Cesium.Viewer | undefined
  replay: ReplayLog | null
  bbox: BBoxDeg | null
  currentStep: number
  interpolatedT: number
}

const CASUALTY_HEX = '#8a8f98'
const ALIVE_PIXEL_SIZE = 8
const CASUALTY_PIXEL_SIZE = 5

/** Inverts the bbox-interpolation convention already used elsewhere for
 *  cell -> lon/lat (see lib/grid.ts's cellIndexAt, lib/treeSprite.ts's
 *  scatterTrees). A replay's soldier {x, y} is a (col, row) into the same
 *  battleground bbox/grid the terrain itself was generated against. */
function cellToLonLat(bbox: BBoxDeg, width: number, height: number, x: number, y: number): [number, number] {
  const dLon = (bbox.east - bbox.west) / width
  const dLat = (bbox.north - bbox.south) / height
  return [bbox.west + (x + 0.5) * dLon, bbox.north - (y + 0.5) * dLat]
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Renders replay soldiers as ground-clamped point entities and animates them
 * between discrete simulation steps via manual position mutation on a RAF
 * loop driven by useReplay's playback state -- not Cesium's SampledPositionProperty/
 * Clock, which nothing in this codebase uses (see hooks/useUnitEntities.ts's
 * dotEntities() for the same point-entity convention this mirrors, and
 * BattlefieldController.tsx's cinematic reveal for the RAF-driven-mutation
 * precedent this follows instead of Cesium's time-dynamic API).
 *
 * z is not applied to position: entities use CLAMP_TO_GROUND (matching the
 * existing convention), so soldiers stand on the real generated terrain
 * surface rather than at a manually-specified height.
 */
export function useSoldierEntities({ viewer, replay, bbox, currentStep, interpolatedT }: Args) {
  const entityMapRef = useRef(new Map<number, Cesium.Entity>())
  const shotsDataSourceRef = useRef<Cesium.CustomDataSource | null>(null)
  const lastShotsStepRef = useRef<number | null>(null)

  // One entity per soldier_index (union across all steps), built once per
  // loaded replay -- never removed/re-added on tick, only mutated in place.
  useEffect(() => {
    if (!viewer || !replay) return

    const teamByIndex = new Map<number, 'blue' | 'red'>()
    for (const step of replay.steps) {
      for (const soldier of step.soldiers) teamByIndex.set(soldier.soldier_index, soldier.team)
    }

    const map = new Map<number, Cesium.Entity>()
    for (const [index, team] of teamByIndex) {
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(0, 0),
        point: {
          pixelSize: ALIVE_PIXEL_SIZE,
          color: Cesium.Color.fromCssColorString(team === 'blue' ? FRIENDLY_HEX : HOSTILE_HEX),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
      map.set(index, entity)
    }
    entityMapRef.current = map

    const shotsDs = new Cesium.CustomDataSource('replay-shots')
    viewer.dataSources.add(shotsDs)
    shotsDataSourceRef.current = shotsDs
    lastShotsStepRef.current = null

    return () => {
      for (const entity of map.values()) viewer.entities.remove(entity)
      map.clear()
      entityMapRef.current = new Map()
      viewer.dataSources.remove(shotsDs, true)
      shotsDataSourceRef.current = null
    }
  }, [viewer, replay])

  // Position + casualty-color updates -- runs on every playback tick
  // (interpolatedT changes every RAF frame while playing).
  useEffect(() => {
    if (!viewer || !replay || !bbox) return
    const step = replay.steps[currentStep]
    if (!step) return
    const nextStep = replay.steps[currentStep + 1]
    const nextByIndex = new Map(nextStep?.soldiers.map((s) => [s.soldier_index, s] as const) ?? [])

    for (const soldier of step.soldiers) {
      const entity = entityMapRef.current.get(soldier.soldier_index)
      if (!entity?.point) continue

      const next = nextByIndex.get(soldier.soldier_index)
      // A soldier absent from the next step, or no longer alive, holds at its
      // last known position instead of interpolating toward nothing.
      const canGlide = next !== undefined && soldier.survival_status === 'alive'
      const x = canGlide ? lerp(soldier.position.x, next.position.x, interpolatedT) : soldier.position.x
      const y = canGlide ? lerp(soldier.position.y, next.position.y, interpolatedT) : soldier.position.y
      const [lon, lat] = cellToLonLat(bbox, replay.battlefield.width, replay.battlefield.height, x, y)
      entity.position = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromDegrees(lon, lat))

      const alive = soldier.survival_status === 'alive'
      entity.point.color = new Cesium.ConstantProperty(
        Cesium.Color.fromCssColorString(alive ? (soldier.team === 'blue' ? FRIENDLY_HEX : HOSTILE_HEX) : CASUALTY_HEX),
      )
      entity.point.pixelSize = new Cesium.ConstantProperty(alive ? ALIVE_PIXEL_SIZE : CASUALTY_PIXEL_SIZE)
    }
  }, [viewer, replay, bbox, currentStep, interpolatedT])

  // Shot tracers -- ephemeral, redrawn only on a real step change (not every
  // interpolation tick), so scrubbing simply clears and redraws from the
  // target step.
  useEffect(() => {
    const shotsDs = shotsDataSourceRef.current
    if (!shotsDs || !replay || !bbox) return
    if (lastShotsStepRef.current === currentStep) return
    lastShotsStepRef.current = currentStep

    shotsDs.entities.removeAll()
    const step = replay.steps[currentStep]
    if (!step) return

    for (const shot of step.shots) {
      const [slon, slat] = cellToLonLat(
        bbox,
        replay.battlefield.width,
        replay.battlefield.height,
        shot.shooter_position.x,
        shot.shooter_position.y,
      )
      const [tlon, tlat] = cellToLonLat(
        bbox,
        replay.battlefield.width,
        replay.battlefield.height,
        shot.target_position.x,
        shot.target_position.y,
      )
      shotsDs.entities.add({
        polyline: {
          positions: [Cesium.Cartesian3.fromDegrees(slon, slat), Cesium.Cartesian3.fromDegrees(tlon, tlat)],
          clampToGround: true,
          width: shot.hit ? 3 : 1.5,
          material: Cesium.Color.fromCssColorString(shot.hit ? '#ef4444' : '#eab308').withAlpha(0.85),
        },
      })
    }
  }, [replay, bbox, currentStep])
}
