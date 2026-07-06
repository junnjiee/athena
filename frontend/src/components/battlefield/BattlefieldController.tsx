import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { useCesium } from 'resium'
import { useBattleground } from '../../state/battleground'
import { renderHeatmapCanvas, renderMaskCanvas, sampleCell } from '../../lib/grid'
import { scatterTrees, treeSpriteDataUrl, type TreeInstance } from '../../lib/treeSprite'
import {
  buildBuildings,
  buildRoads,
  buildWarningMarkers,
  buildWater,
  freezeBuildings,
  restyleBuildings,
  restyleRoads,
  restyleWater,
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

/** Lives inside <Viewer>. Renders the generated battlefield (buildings, roads,
 *  water, procedural trees, heatmap drape), runs the cinematic reveal, samples
 *  terrain under the cursor, and applies night lighting. */
export function BattlefieldController() {
  const { viewer } = useCesium()
  const phase = useBattleground((s) => s.phase)
  const grid = useBattleground((s) => s.grid)
  const features = useBattleground((s) => s.features)
  const meta = useBattleground((s) => s.meta)
  const revealToken = useBattleground((s) => s.revealToken)
  const heatmap = useBattleground((s) => s.heatmap)
  const layers = useBattleground((s) => s.layers)
  const night = useBattleground((s) => s.night)
  const monochrome = useBattleground((s) => s.monochrome)
  const planAnalysis = useBattleground((s) => s.planAnalysis)
  const viewshed = useBattleground((s) => s.viewshed)
  const suggestedPath = useBattleground((s) => s.suggestedPath)

  const buildingsDsRef = useRef<Cesium.CustomDataSource | null>(null)
  const roadsDsRef = useRef<Cesium.CustomDataSource | null>(null)
  const waterDsRef = useRef<Cesium.CustomDataSource | null>(null)
  const warningsDsRef = useRef<Cesium.CustomDataSource | null>(null)
  const treesRef = useRef<Cesium.BillboardCollection | null>(null)
  const treeInstancesRef = useRef<TreeInstance[]>([])
  const heatmapLayerRef = useRef<Cesium.ImageryLayer | null>(null)
  const viewshedLayerRef = useRef<Cesium.ImageryLayer | null>(null)
  const ghostDsRef = useRef<Cesium.CustomDataSource | null>(null)
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

    // Captured once at build time, not a reactive dependency of this effect --
    // toggling monochrome mid-session restyles in place (see the effect below)
    // rather than replaying this whole 5s reveal + camera flight.
    const monochromeAtBuild = useBattleground.getState().monochrome

    revealTRef.current = 0
    buildBuildings(
      buildingsDs,
      features,
      () => stageFactor(revealTRef.current, STAGE.buildingsStart, STAGE.buildingsEnd),
      monochromeAtBuild,
    )
    buildRoads(roadsDs, features, monochromeAtBuild)
    buildWater(waterDs, features, monochromeAtBuild)

    const trees = new Cesium.BillboardCollection({ scene: viewer.scene })
    viewer.scene.primitives.add(trees)
    treesRef.current = trees
    const sprites = [
      treeSpriteDataUrl(0, monochromeAtBuild),
      treeSpriteDataUrl(1, monochromeAtBuild),
      treeSpriteDataUrl(2, monochromeAtBuild),
    ]
    const instances = scatterTrees(grid)
    treeInstancesRef.current = instances
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
      treeInstancesRef.current = []
    }
  }, [viewer, grid, features, revealToken])

  // --- layer visibility toggles -------------------------------------------
  useEffect(() => {
    if (buildingsDsRef.current) buildingsDsRef.current.show = layers.buildings
    if (roadsDsRef.current && revealTRef.current >= STAGE.roads) roadsDsRef.current.show = layers.roads
    if (waterDsRef.current && revealTRef.current >= STAGE.water) waterDsRef.current.show = layers.water
    if (treesRef.current) treesRef.current.show = layers.trees
  }, [layers, revealToken])

  // --- monochrome restyle (in place, no rebuild/reveal replay) ---------------
  useEffect(() => {
    if (buildingsDsRef.current) restyleBuildings(buildingsDsRef.current, monochrome)
    if (roadsDsRef.current) restyleRoads(roadsDsRef.current, monochrome)
    if (waterDsRef.current) restyleWater(waterDsRef.current, monochrome)

    const trees = treesRef.current
    const instances = treeInstancesRef.current
    if (!trees || instances.length === 0) return
    const sprites = [
      treeSpriteDataUrl(0, monochrome),
      treeSpriteDataUrl(1, monochrome),
      treeSpriteDataUrl(2, monochrome),
    ]
    // trees.length may be less than instances.length if the reveal animation hasn't
    // finished scattering them all yet -- restyle only what's actually been added.
    const n = Math.min(trees.length, instances.length)
    for (let i = 0; i < n; i++) {
      trees.get(i).image = sprites[instances[i].variant]
    }
  }, [monochrome])

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
    if (heatmap === 'none' || phase !== 'ready') return

    const rectangle = Cesium.Rectangle.fromDegrees(
      grid.bbox.west,
      grid.bbox.south,
      grid.bbox.east,
      grid.bbox.north,
    )
    const dataUrl = renderHeatmapCanvas(grid, heatmap, monochrome).toDataURL('image/png')
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
  }, [viewer, grid, heatmap, phase, monochrome])

  // --- friendly-unit viewshed drape ------------------------------------------
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !grid) return
    let cancelled = false

    const previous = viewshedLayerRef.current
    if (previous) {
      viewer.imageryLayers.remove(previous, true)
      viewshedLayerRef.current = null
    }
    if (!viewshed || phase !== 'ready') return

    const rectangle = Cesium.Rectangle.fromDegrees(
      grid.bbox.west,
      grid.bbox.south,
      grid.bbox.east,
      grid.bbox.north,
    )
    const dataUrl = renderMaskCanvas(grid.width, grid.height, viewshed.mask, [56, 189, 248, 120]).toDataURL(
      'image/png',
    )
    void Cesium.SingleTileImageryProvider.fromUrl(dataUrl, { rectangle }).then((provider) => {
      if (cancelled || viewer.isDestroyed()) return
      const layer = viewer.imageryLayers.addImageryProvider(provider)
      layer.alpha = 0.75
      viewshedLayerRef.current = layer
    })

    return () => {
      cancelled = true
      if (viewshedLayerRef.current && !viewer.isDestroyed()) {
        viewer.imageryLayers.remove(viewshedLayerRef.current, true)
        viewshedLayerRef.current = null
      }
    }
  }, [viewer, grid, viewshed, phase])

  // --- suggested (ghost) route preview ---------------------------------------
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    const ds = new Cesium.CustomDataSource('bf-ghost-route')
    void viewer.dataSources.add(ds)
    ghostDsRef.current = ds
    if (suggestedPath && suggestedPath.length >= 2) {
      ds.entities.add({
        polyline: {
          positions: suggestedPath.map((p) => Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude)),
          clampToGround: true,
          width: 5,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('#38bdf8'),
            dashLength: 18,
          }),
        },
      })
    }
    return () => {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true)
      ghostDsRef.current = null
    }
  }, [viewer, suggestedPath])

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
      const cartesian = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined
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
