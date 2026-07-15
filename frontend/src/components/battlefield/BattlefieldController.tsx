import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { useCesium } from 'resium'
import { useBattleground } from '../../state/battleground'
import { renderHeatmapCanvas, sampleCell } from '../../lib/grid'
import { scatterTrees, treeSpriteDataUrl } from '../../lib/treeSprite'
import {
  buildBuildings,
  buildRoads,
  buildWarningMarkers,
  buildWater,
  freezeBuildings,
} from './entityBuilders'

const REVEAL_MS = 5000
/** stage windows within the 0–1 reveal timeline */
const STAGE = {
  roads: 0.22,
  water: 0.32,
  buildingsStart: 0.4,
  buildingsEnd: 0.78,
  treesStart: 0.5,
  treesEnd: 0.95,
} as const

function stageFactor(t: number, start: number, end: number): number {
  if (t <= start) return 0
  if (t >= end) return 1
  const x = (t - start) / (end - start)
  return x * x * (3 - 2 * x) // smoothstep
}

/** Relight the scene for day (13:00 local) or night (21:00 local). Local solar
 *  time is approximated from the battlefield's longitude — good enough to put
 *  the sun (or moon) where the toggle promises. */
function applyNightLighting(viewer: Cesium.Viewer, night: boolean, centerLonDeg: number): void {
  const utcHourFor = (localHour: number) => (localHour - centerLonDeg / 15 + 24) % 24
  const date = new Date()
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCMinutes(Math.round(utcHourFor(night ? 21 : 13) * 60))
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(date)
  viewer.clock.shouldAnimate = false
  viewer.scene.globe.enableLighting = night
  if (viewer.scene.moon) viewer.scene.moon.show = night
  if (night) {
    viewer.scene.light = new Cesium.SunLight()
    viewer.scene.globe.dynamicAtmosphereLighting = true
  }
  viewer.scene.requestRender()
}

interface Props {
  /** RECON (photo) mode active: the photoreal mesh carries its own real
   *  buildings/trees/roads, so the stylized battlefield layers and the
   *  globe-draped heatmap are hidden until the mode exits. */
  suppressed?: boolean
}

/** Lives inside <Viewer>. Renders the generated battlefield (buildings, roads,
 *  water, procedural trees, heatmap drape), runs the cinematic reveal, samples
 *  terrain under the cursor, and applies night lighting. */
export function BattlefieldController({ suppressed = false }: Props) {
  const { viewer } = useCesium()
  const phase = useBattleground((s) => s.phase)
  const grid = useBattleground((s) => s.grid)
  const features = useBattleground((s) => s.features)
  const meta = useBattleground((s) => s.meta)
  const revealToken = useBattleground((s) => s.revealToken)
  const heatmap = useBattleground((s) => s.heatmap)
  const layers = useBattleground((s) => s.layers)
  const night = useBattleground((s) => s.night)
  const planAnalysis = useBattleground((s) => s.planAnalysis)

  const buildingsDsRef = useRef<Cesium.CustomDataSource | null>(null)
  const roadsDsRef = useRef<Cesium.CustomDataSource | null>(null)
  const waterDsRef = useRef<Cesium.CustomDataSource | null>(null)
  const warningsDsRef = useRef<Cesium.CustomDataSource | null>(null)
  const treesRef = useRef<Cesium.BillboardCollection | null>(null)
  const heatmapLayerRef = useRef<Cesium.ImageryLayer | null>(null)
  const revealTRef = useRef(0)

  // --- battlefield content + cinematic reveal -----------------------------
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !grid || !features || revealToken === 0) return

    const buildingsDs = new Cesium.CustomDataSource('bf-buildings')
    const roadsDs = new Cesium.CustomDataSource('bf-roads')
    const waterDs = new Cesium.CustomDataSource('bf-water')
    roadsDs.show = false
    waterDs.show = false
    void viewer.dataSources.add(buildingsDs)
    void viewer.dataSources.add(roadsDs)
    void viewer.dataSources.add(waterDs)
    buildingsDsRef.current = buildingsDs
    roadsDsRef.current = roadsDs
    waterDsRef.current = waterDs

    revealTRef.current = 0
    buildBuildings(buildingsDs, features, () =>
      stageFactor(revealTRef.current, STAGE.buildingsStart, STAGE.buildingsEnd),
    )
    buildRoads(roadsDs, features)
    buildWater(waterDs, features)

    const trees = new Cesium.BillboardCollection({ scene: viewer.scene })
    viewer.scene.primitives.add(trees)
    treesRef.current = trees
    const sprites = [treeSpriteDataUrl(0), treeSpriteDataUrl(1), treeSpriteDataUrl(2)]
    const instances = scatterTrees(grid)
    let treesAdded = 0

    // settle the camera into an oblique overview of the battlefield
    const rect = Cesium.Rectangle.fromDegrees(
      grid.bbox.west,
      grid.bbox.south,
      grid.bbox.east,
      grid.bbox.north,
    )
    const center = Cesium.Rectangle.center(rect)
    const diagonal = Cesium.Cartesian3.distance(
      Cesium.Cartesian3.fromRadians(rect.west, rect.south),
      Cesium.Cartesian3.fromRadians(rect.east, rect.north),
    )
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(Cesium.Cartesian3.fromRadians(center.longitude, center.latitude), diagonal / 2),
      {
        duration: 2.4,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-38), diagonal * 1.15),
      },
    )

    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / REVEAL_MS)
      revealTRef.current = t
      if (t >= STAGE.roads) roadsDs.show = true
      if (t >= STAGE.water) waterDs.show = true

      const treeTarget = Math.floor(
        stageFactor(t, STAGE.treesStart, STAGE.treesEnd) * instances.length,
      )
      while (treesAdded < treeTarget) {
        const inst = instances[treesAdded++]
        trees.add({
          position: Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude),
          image: sprites[inst.variant],
          width: inst.size * 0.66,
          height: inst.size,
          sizeInMeters: true,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        })
      }

      if (t < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        freezeBuildings(buildingsDs)
      }
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      if (!viewer.isDestroyed()) {
        viewer.dataSources.remove(buildingsDs, true)
        viewer.dataSources.remove(roadsDs, true)
        viewer.dataSources.remove(waterDs, true)
        viewer.scene.primitives.remove(trees)
      }
      buildingsDsRef.current = null
      roadsDsRef.current = null
      waterDsRef.current = null
      treesRef.current = null
    }
  }, [viewer, grid, features, revealToken])

  // --- layer visibility toggles -------------------------------------------
  useEffect(() => {
    if (buildingsDsRef.current) buildingsDsRef.current.show = layers.buildings && !suppressed
    if (roadsDsRef.current && revealTRef.current >= STAGE.roads) roadsDsRef.current.show = layers.roads && !suppressed
    if (waterDsRef.current && revealTRef.current >= STAGE.water) waterDsRef.current.show = layers.water && !suppressed
    if (treesRef.current) treesRef.current.show = layers.trees && !suppressed
  }, [layers, revealToken, suppressed])

  // --- heatmap drape --------------------------------------------------------
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !grid) return
    let cancelled = false
    let raf = 0

    const previous = heatmapLayerRef.current
    if (previous) {
      viewer.imageryLayers.remove(previous, true)
      heatmapLayerRef.current = null
    }
    if (heatmap === 'none' || phase !== 'ready' || suppressed) return

    const rectangle = Cesium.Rectangle.fromDegrees(
      grid.bbox.west,
      grid.bbox.south,
      grid.bbox.east,
      grid.bbox.north,
    )
    const dataUrl = renderHeatmapCanvas(grid, heatmap).toDataURL('image/png')
    void Cesium.SingleTileImageryProvider.fromUrl(dataUrl, { rectangle }).then((provider) => {
      if (cancelled || viewer.isDestroyed()) return
      const layer = viewer.imageryLayers.addImageryProvider(provider)
      layer.alpha = 0
      heatmapLayerRef.current = layer
      const start = performance.now()
      const fade = (now: number) => {
        if (cancelled || viewer.isDestroyed()) return
        layer.alpha = Math.min(1, (now - start) / 400) * 0.82
        if (layer.alpha < 0.82) raf = requestAnimationFrame(fade)
      }
      raf = requestAnimationFrame(fade)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      if (heatmapLayerRef.current && !viewer.isDestroyed()) {
        viewer.imageryLayers.remove(heatmapLayerRef.current, true)
        heatmapLayerRef.current = null
      }
    }
  }, [viewer, grid, heatmap, phase, suppressed])

  // --- terrain hover sampling ----------------------------------------------
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !grid || phase !== 'ready') return
    const setHoverCell = useBattleground.getState().setHoverCell
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    let last = 0
    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      const now = performance.now()
      if (now - last < 40) return
      last = now
      const ray = viewer.camera.getPickRay(movement.endPosition)
      let cartesian = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined
      // Photo mode hides the globe -- depth-buffer picking against the
      // photoreal mesh keeps the terrain-info hover (and its grid ref) alive.
      if (!cartesian && !viewer.scene.globe.show && viewer.scene.pickPositionSupported) {
        cartesian = viewer.scene.pickPosition(movement.endPosition)
      }
      if (!cartesian) {
        setHoverCell(null)
        return
      }
      const carto = Cesium.Cartographic.fromCartesian(cartesian)
      setHoverCell(
        sampleCell(grid, Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)),
      )
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    return () => {
      handler.destroy()
      setHoverCell(null)
    }
  }, [viewer, grid, phase])

  // --- plan warning markers --------------------------------------------------
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    const ds = new Cesium.CustomDataSource('bf-warnings')
    void viewer.dataSources.add(ds)
    warningsDsRef.current = ds
    if (planAnalysis) buildWarningMarkers(ds, planAnalysis.warnings)
    return () => {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true)
      warningsDsRef.current = null
    }
  }, [viewer, planAnalysis])

  // --- night lighting ----------------------------------------------------------
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    applyNightLighting(viewer, night, meta ? (meta.bbox.west + meta.bbox.east) / 2 : 0)
  }, [viewer, night, meta])

  return null
}
