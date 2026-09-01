import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { useCesium } from 'resium'
import { useBattleground } from '../../state/battleground'
import { currentStep, usePlayback } from '../../state/playback'
import { cellToLonLat, renderDensityCanvas } from '../../lib/replayGeo'
import { soldierSprite, commanderRing } from '../../lib/soldierSprite'

/**
 * A run playing out on the globe, on the ground it was actually fought on.
 *
 * Soldiers are billboards clamped to terrain, so they stand on the hillside
 * rather than floating over it, and they are re-positioned per tick rather than
 * rebuilt: a BillboardCollection updated in place costs nothing per frame,
 * where recreating entities every tick would stutter through a hundred-tick
 * run.
 *
 * The drape underneath is the aggregate across every run in the batch — where
 * this plan tends to take people, and where it tends to get them killed. That is
 * the thing a commander corrects a plan against, and it is why it is computed
 * over runs rather than from the single run being watched.
 */

/** Tracers live for the tick they were fired in, so they read as fire rather
 *  than as accumulated clutter. */
const SHOT_COLOR_HIT = Cesium.Color.fromCssColorString('#ffd7a0')
const SHOT_COLOR_MISS = Cesium.Color.fromCssColorString('#ffd7a0').withAlpha(0.3)

export function ReplayController() {
  const { viewer } = useCesium()
  const grid = useBattleground((s) => s.grid)
  const replay = usePlayback((s) => s.replay)
  const step = usePlayback(currentStep)
  const density = usePlayback((s) => s.density)
  const densityLayer = usePlayback((s) => s.densityLayer)

  // Which way each soldier was last seen moving, so a figure faces its advance
  // rather than always facing the same way. Kept across ticks because a soldier
  // that halts should keep facing where it was going.
  const facingRef = useRef<Map<number, boolean>>(new Map())
  const soldiersRef = useRef<Cesium.BillboardCollection | null>(null)
  const ringsRef = useRef<Cesium.BillboardCollection | null>(null)
  const labelsRef = useRef<Cesium.LabelCollection | null>(null)
  const shotsRef = useRef<Cesium.CustomDataSource | null>(null)
  const densityLayerRef = useRef<Cesium.ImageryLayer | null>(null)

  // --- collections live for as long as a replay is loaded --------------------
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !replay) return

    const soldiers = new Cesium.BillboardCollection({ scene: viewer.scene })
    const rings = new Cesium.BillboardCollection({ scene: viewer.scene })
    const labels = new Cesium.LabelCollection({ scene: viewer.scene })
    const shots = new Cesium.CustomDataSource('replay-shots')
    viewer.scene.primitives.add(soldiers)
    viewer.scene.primitives.add(rings)
    viewer.scene.primitives.add(labels)
    void viewer.dataSources.add(shots)
    soldiersRef.current = soldiers
    ringsRef.current = rings
    labelsRef.current = labels
    shotsRef.current = shots

    return () => {
      if (viewer.isDestroyed()) return
      viewer.scene.primitives.remove(soldiers)
      viewer.scene.primitives.remove(rings)
      viewer.scene.primitives.remove(labels)
      void viewer.dataSources.remove(shots, true)
      soldiersRef.current = null
      ringsRef.current = null
      labelsRef.current = null
      shotsRef.current = null
    }
  }, [viewer, replay])

  // --- soldiers walk between ticks --------------------------------------
  //
  // A tick is a decision, not a photograph. Placing soldiers only on tick
  // boundaries means one covering eight cells jumps eight metres, and the
  // ground it crossed -- the slope, the treeline it skirted, the water it went
  // round -- is never shown. This interpolates every frame between the tick
  // being shown and the next one, so a soldier walks its route and you can see
  // what it walked over.
  useEffect(() => {
    const soldiers = soldiersRef.current
    const rings = ringsRef.current
    const labels = labelsRef.current
    const shots = shotsRef.current
    if (!viewer || viewer.isDestroyed() || !grid || !replay || !soldiers) return
    if (!rings || !labels || !shots) return

    let frame = 0

    const render = () => {
      const state = usePlayback.getState()
      const index = Math.min(state.step, replay.steps.length - 1)
      const from = replay.steps[index]
      const to = replay.steps[Math.min(index + 1, replay.steps.length - 1)]
      if (!from) return

      // Only tween while playing; scrubbing should land on the tick exactly.
      const elapsed = performance.now() - state.stepStartedAt
      const t = state.playing
        ? Math.max(0, Math.min(1, elapsed / Math.max(1, state.tickMs)))
        : 0

      const next = new Map(to.soldiers.map((s) => [s.soldier_index, s.position]))

      // Facing, from where each soldier is heading this tick.
      for (const soldier of from.soldiers) {
        const ahead = next.get(soldier.soldier_index)
        if (!ahead || ahead.x === soldier.position.x) continue
        facingRef.current.set(soldier.soldier_index, ahead.x < soldier.position.x)
      }

      soldiers.removeAll()
      rings.removeAll()
      labels.removeAll()

      const rationale = new Map<number, string>()
      for (const decision of from.decisions ?? []) {
        rationale.set(
          decision.soldier_index,
          `${decision.action} — ${decision.rationale}`,
        )
      }

      for (const soldier of from.soldiers) {
        const alive = soldier.survival_status === 'alive'
        const ahead = next.get(soldier.soldier_index) ?? soldier.position
        // Casualties do not slide to wherever the corpse is recorded next.
        const blend = alive ? t : 0
        const x = soldier.position.x + (ahead.x - soldier.position.x) * blend
        const y = soldier.position.y + (ahead.y - soldier.position.y) * blend
        const { longitude, latitude } = cellToLonLat(grid, x, y)
        const position = Cesium.Cartesian3.fromDegrees(longitude, latitude)

        soldiers.add({
          position,
          image: soldierSprite(
            soldier.team,
            alive,
            facingRef.current.get(soldier.soldier_index) ?? false,
          ),
          width: alive ? 22 : 26,
          height: alive ? 35 : 26,
          scaleByDistance: new Cesium.NearFarScalar(60, 1.4, 2500, 0.45),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        })

        const says = rationale.get(soldier.soldier_index)
        if (says && alive) {
          rings.add({
            position,
            image: commanderRing(soldier.team),
            width: 30,
            height: 30,
            scaleByDistance: new Cesium.NearFarScalar(60, 1.4, 2500, 0.45),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          })
          if (usePlayback.getState().showReasoning) {
            labels.add({
              position,
              text: says.length > 90 ? `${says.slice(0, 88)}…` : says,
              font: '12px system-ui, sans-serif',
              fillColor: Cesium.Color.WHITE,
              showBackground: true,
              backgroundColor: Cesium.Color.fromCssColorString('rgba(12,14,18,0.82)'),
              backgroundPadding: new Cesium.Cartesian2(7, 5),
              horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(10, -26),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 900),
            })
          }
        }
      }

      frame = requestAnimationFrame(render)
    }

    frame = requestAnimationFrame(render)
    return () => cancelAnimationFrame(frame)
  }, [viewer, grid, replay])

  // --- tracers, which belong to a tick rather than to a frame ---------------
  useEffect(() => {
    const shots = shotsRef.current
    if (!viewer || viewer.isDestroyed() || !grid || !shots || !step) return

    shots.entities.removeAll()
    for (const shot of step.shots) {
      const from = cellToLonLat(grid, shot.shooter_position.x, shot.shooter_position.y)
      const to = cellToLonLat(grid, shot.target_position.x, shot.target_position.y)
      shots.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray([
            from.longitude,
            from.latitude,
            to.longitude,
            to.latitude,
          ]),
          width: shot.hit ? 2.5 : 1.5,
          material: shot.hit ? SHOT_COLOR_HIT : SHOT_COLOR_MISS,
          clampToGround: true,
        },
      })
    }
  }, [viewer, grid, step])

  // --- the aggregate drape --------------------------------------------------
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !grid) return

    const previous = densityLayerRef.current
    if (previous) {
      viewer.imageryLayers.remove(previous, true)
      densityLayerRef.current = null
    }
    if (!density || densityLayer === 'none') return

    let cancelled = false
    const rectangle = Cesium.Rectangle.fromDegrees(
      grid.bbox.west,
      grid.bbox.south,
      grid.bbox.east,
      grid.bbox.north,
    )
    const dataUrl = renderDensityCanvas(grid, density, densityLayer).toDataURL('image/png')
    void Cesium.SingleTileImageryProvider.fromUrl(dataUrl, { rectangle }).then(
      (provider) => {
        if (cancelled || viewer.isDestroyed()) return
        const layer = viewer.imageryLayers.addImageryProvider(provider)
        layer.alpha = 0.85
        densityLayerRef.current = layer
      },
    )

    return () => {
      cancelled = true
      if (densityLayerRef.current && !viewer.isDestroyed()) {
        viewer.imageryLayers.remove(densityLayerRef.current, true)
        densityLayerRef.current = null
      }
    }
  }, [viewer, grid, density, densityLayer])

  return null
}
