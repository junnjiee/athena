import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { useCesium } from 'resium'
import { useBattleground } from '../../state/battleground'
import { usePhoto } from '../../state/photo'
import { createPhotoTileset } from '../../lib/photoTiles'
import { QUALITY_TIERS, initialGovernor, stepGovernor, type GovernorState } from '../../lib/frameGovernor'
import { fetchSplatIndex, loadSplatTileset } from '../../lib/splats'
import { measureMeshOffset, type MeshProbe } from '../../lib/photoHeights'
import { sampleCell } from '../../lib/grid'
import type { GridData } from '../../types/terrain'

interface Props {
  /** viewMode === 'photo' */
  active: boolean
}

/** Background warm starts only after the cinematic reveal has settled, so the
 *  two never compete for decode workers / GPU uploads. */
const WARM_DELAY_MS = 8000
/** Hero splats render only within this range of the camera -- wide views pay
 *  zero splat sort/draw cost. */
const SPLAT_RANGE_M = 2500

function buildProbes(grid: GridData): MeshProbe[] {
  const { west, east, south, north } = grid.bbox
  // center + quarter points, inset so every probe is inside the clipped mesh
  const fractions: [number, number][] = [
    [0.5, 0.5],
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ]
  const probes: MeshProbe[] = []
  for (const [fx, fy] of fractions) {
    const longitude = west + (east - west) * fx
    const latitude = south + (north - south) * fy
    const cell = sampleCell(grid, longitude, latitude)
    if (cell) probes.push({ point: { longitude, latitude }, demHeightM: cell.elevation })
  }
  return probes
}

/** Swap the scene to photoreal: the Google mesh replaces the globe (hiding it
 *  avoids z-fighting between two disagreeing terrains), vertical exaggeration
 *  is pinned to 1.0 (it distorts 3D Tiles in cesium 1.143), and MSAA drops to
 *  1x -- photoreal textures hide aliasing well and 4x MSAA is pure GPU tax on
 *  integrated graphics. Returns what to restore on exit. */
function enterPhotoScene(viewer: Cesium.Viewer): { exaggeration: number; msaa: number } {
  const scene = viewer.scene
  const saved = { exaggeration: scene.verticalExaggeration, msaa: scene.msaaSamples }
  scene.globe.show = false
  scene.verticalExaggeration = 1.0
  scene.msaaSamples = 1
  scene.requestRender()
  return saved
}

function exitPhotoScene(viewer: Cesium.Viewer, saved: { exaggeration: number; msaa: number }): void {
  const scene = viewer.scene
  scene.globe.show = true
  scene.verticalExaggeration = saved.exaggeration
  scene.msaaSamples = saved.msaa
  viewer.resolutionScale = 1.0
  scene.requestRender()
}

function showTilesets(tilesets: readonly (Cesium.Cesium3DTileset | null)[], show: boolean): void {
  for (const tileset of tilesets) {
    if (tileset) tileset.show = show
  }
}

function setPreloadWhenHidden(tileset: Cesium.Cesium3DTileset, preload: boolean): void {
  tileset.preloadWhenHidden = preload
}

/** Apply a quality tier: tile detail + render resolution. */
function applyTier(viewer: Cesium.Viewer, tileset: Cesium.Cesium3DTileset | null, tierIndex: number): void {
  const tier = QUALITY_TIERS[tierIndex]
  if (tileset) tileset.maximumScreenSpaceError = tier.sse
  viewer.resolutionScale = tier.resolutionScale
  viewer.scene.requestRender()
}

/** Distance-gate hero splats: sorting/drawing gaussians only pays off when the
 *  camera is close enough to see the fidelity. */
function updateSplatVisibility(
  viewer: Cesium.Viewer,
  splats: readonly Cesium.Cesium3DTileset[],
  active: boolean,
  tierAllows: boolean,
): void {
  const cameraPosition = viewer.camera.positionWC
  for (const splat of splats) {
    const sphere = splat.boundingSphere
    const distance = Cesium.Cartesian3.distance(cameraPosition, sphere.center) - sphere.radius
    splat.show = active && tierAllows && distance < SPLAT_RANGE_M
  }
}

/** Real occlusion (distance 0) vs X-ray (Infinity) for every plan marker.
 *
 *  MUST be idempotent: assigning an entity property raises the collection's
 *  collectionChanged event, and this function runs from that very event -- an
 *  unconditional assignment (always a "change", since each ConstantProperty is
 *  a fresh instance) re-fires the event and locks the tab in an infinite
 *  assign->event->assign loop. Only write when the value actually differs. */
function applyDepthTestDistance(viewer: Cesium.Viewer, distance: number): void {
  const now = Cesium.JulianDate.now()
  let changed = false
  for (const entity of viewer.entities.values) {
    for (const graphics of [entity.billboard, entity.label]) {
      if (!graphics) continue
      const current: unknown = graphics.disableDepthTestDistance?.getValue(now)
      if (current !== distance) {
        graphics.disableDepthTestDistance = new Cesium.ConstantProperty(distance)
        changed = true
      }
    }
  }
  if (changed) viewer.scene.requestRender()
}

function attachTileset(viewer: Cesium.Viewer, tileset: Cesium.Cesium3DTileset, show: boolean): void {
  viewer.scene.primitives.add(tileset)
  tileset.show = show
}

/** Lives inside <Viewer>. Owns the RECON-mode photoreal stack with a strict
 *  "pay only for what's on screen" budget:
 *
 *  - the Google tileset is created idle; background warming is a one-shot
 *    window (opens after the reveal settles, closes itself on
 *    initialTilesLoaded) instead of a standing preload
 *  - hero splats load lazily on first RECON entry and are distance-gated
 *  - while active, an adaptive governor watches frame time and walks quality
 *    tiers (tile detail -> resolution -> splats) so the mode converges to an
 *    interactive framerate instead of lagging */
export function PhotoModeController({ active }: Props) {
  const { viewer } = useCesium()
  const phase = useBattleground((s) => s.phase)
  const grid = useBattleground((s) => s.grid)
  const xray = usePhoto((s) => s.xray)
  const ready = usePhoto((s) => s.ready)

  const tilesetRef = useRef<Cesium.Cesium3DTileset | null>(null)
  const splatsRef = useRef<Cesium.Cesium3DTileset[]>([])
  const splatsRequestedRef = useRef(false)
  const tilesLoadedRef = useRef(0)
  const pendingRequestsRef = useRef(0)
  const governorRef = useRef<GovernorState>(initialGovernor())
  const lastFrameAtRef = useRef(0)

  // --- tileset lifecycle: create idle, warm in a bounded window --------------
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || phase !== 'ready' || !grid) return
    let cancelled = false
    const patch = usePhoto.getState().patch
    tilesLoadedRef.current = 0
    pendingRequestsRef.current = 0
    patch({ warming: false, ready: false, toggleMs: null, meshOffsetM: null, stats: null, splatCount: 0 })

    const warmTimerRef = { id: 0 }
    void createPhotoTileset(grid.bbox)
      .then((tileset) => {
        if (!tileset) return
        if (cancelled || viewer.isDestroyed()) return
        attachTileset(viewer, tileset, usePhoto.getState().active)
        tilesetRef.current = tileset
        tileset.tileLoad.addEventListener(() => {
          tilesLoadedRef.current += 1
        })
        tileset.loadProgress.addEventListener((numberOfPendingRequests: number) => {
          pendingRequestsRef.current = numberOfPendingRequests
        })
        tileset.initialTilesLoaded.addEventListener(() => {
          // warm complete: stop all background streaming; loaded tiles stay in
          // the session cache, so the next RECON entry is still near-instant
          setPreloadWhenHidden(tileset, false)
          if (!cancelled) usePhoto.getState().patch({ ready: true, warming: false })
        })
        // one-shot warm window, after the cinematic reveal has settled
        warmTimerRef.id = window.setTimeout(() => {
          if (cancelled || viewer.isDestroyed() || usePhoto.getState().ready) return
          setPreloadWhenHidden(tileset, true)
          usePhoto.getState().patch({ warming: true })
        }, WARM_DELAY_MS)
      })
      .catch((error: unknown) => {
        console.warn('[Athena] photoreal tileset failed to load', error)
      })

    return () => {
      cancelled = true
      window.clearTimeout(warmTimerRef.id)
      if (!viewer.isDestroyed()) {
        // primitives.remove destroys by default
        if (tilesetRef.current) viewer.scene.primitives.remove(tilesetRef.current)
        for (const splat of splatsRef.current) viewer.scene.primitives.remove(splat)
      }
      tilesetRef.current = null
      splatsRef.current = []
      splatsRequestedRef.current = false
      usePhoto.getState().patch({ warming: false, ready: false, stats: null, splatCount: 0 })
    }
  }, [viewer, phase, grid])

  // --- hero splats: lazy-load on first RECON entry only ----------------------
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !active || phase !== 'ready' || splatsRequestedRef.current) return
    splatsRequestedRef.current = true
    let disposed = false
    void fetchSplatIndex().then(async (configs) => {
      for (const config of configs) {
        if (disposed || viewer.isDestroyed()) return
        try {
          const tileset = await loadSplatTileset(config)
          if (!tileset) continue
          if (disposed || viewer.isDestroyed()) return
          attachTileset(viewer, tileset, false)
          splatsRef.current = [...splatsRef.current, tileset]
          usePhoto.getState().patch({ splatCount: splatsRef.current.length })
          updateSplatVisibility(
            viewer,
            splatsRef.current,
            usePhoto.getState().active,
            QUALITY_TIERS[governorRef.current.tier].splats,
          )
        } catch (error: unknown) {
          console.warn(`[Athena] splat "${config.name}" failed to load`, error)
        }
      }
    })
    return () => {
      // tilesets themselves are owned/removed by the lifecycle effect above
      disposed = true
    }
  }, [viewer, active, phase])

  // --- activation: swap the scene over, measure time-to-first-photon ---------
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    const patch = usePhoto.getState().patch
    patch({ active })
    if (!active) return

    const saved = enterPhotoScene(viewer)
    const tileset = tilesetRef.current
    showTilesets([tileset], true)
    if (tileset) {
      const t0 = performance.now()
      if (usePhoto.getState().ready) {
        patch({ toggleMs: 0 })
      } else {
        const unsubscribe = tileset.initialTilesLoaded.addEventListener(() => {
          patch({ toggleMs: Math.round(performance.now() - t0) })
          unsubscribe()
        })
      }
    }

    return () => {
      if (viewer.isDestroyed()) return
      showTilesets([tilesetRef.current, ...splatsRef.current], false)
      exitPhotoScene(viewer, saved)
    }
  }, [viewer, active])

  // --- adaptive quality governor: converge to interactive frame times --------
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !active) return
    const scene = viewer.scene
    governorRef.current = initialGovernor()
    lastFrameAtRef.current = performance.now()
    usePhoto.getState().patch({ tier: governorRef.current.tier })
    applyTier(viewer, tilesetRef.current, governorRef.current.tier)
    updateSplatVisibility(viewer, splatsRef.current, true, QUALITY_TIERS[governorRef.current.tier].splats)

    const onPostRender = () => {
      const now = performance.now()
      const frameMs = now - lastFrameAtRef.current
      lastFrameAtRef.current = now
      const next = stepGovernor(governorRef.current, frameMs)
      const tierChanged = next.tier !== governorRef.current.tier
      governorRef.current = next
      if (tierChanged) {
        applyTier(viewer, tilesetRef.current, next.tier)
        updateSplatVisibility(viewer, splatsRef.current, true, QUALITY_TIERS[next.tier].splats)
        usePhoto.getState().patch({ tier: next.tier })
      }
    }
    scene.postRender.addEventListener(onPostRender)

    const onMoveEnd = () => {
      updateSplatVisibility(viewer, splatsRef.current, true, QUALITY_TIERS[governorRef.current.tier].splats)
    }
    viewer.camera.moveEnd.addEventListener(onMoveEnd)

    return () => {
      scene.postRender.removeEventListener(onPostRender)
      viewer.camera.moveEnd.removeEventListener(onMoveEnd)
    }
  }, [viewer, active])

  // --- occlusion / X-ray: real depth-tested markers among the buildings ------
  useEffect(() => {
    // Only touch marker depth-testing while photo mode is actually active --
    // outside it, entities keep their built-in always-on-top defaults and this
    // controller must not subscribe to (or mutate on) collection changes at all.
    if (!viewer || viewer.isDestroyed() || !active) return
    const apply = () => applyDepthTestDistance(viewer, xray ? Number.POSITIVE_INFINITY : 0)
    apply()
    // plan edits while in photo mode create fresh entities with the default
    // always-on-top behavior -- re-apply whenever the collection changes
    // (applyDepthTestDistance is idempotent, so the event can't loop)
    viewer.entities.collectionChanged.addEventListener(apply)

    return () => {
      viewer.entities.collectionChanged.removeEventListener(apply)
      if (!viewer.isDestroyed()) applyDepthTestDistance(viewer, Number.POSITIVE_INFINITY)
    }
  }, [viewer, active, xray])

  // --- DEM-vs-mesh vertical disagreement probe (HUD diagnostics) -------------
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !active || !ready || !grid) return
    let cancelled = false
    void measureMeshOffset(viewer.scene, buildProbes(grid)).then((offset) => {
      if (!cancelled) usePhoto.getState().patch({ meshOffsetM: offset })
    })
    return () => {
      cancelled = true
    }
  }, [viewer, active, ready, grid])

  // --- tile stream stats for the HUD (public tileLoad/loadProgress events) ---
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !active) return
    const id = window.setInterval(() => {
      const tileset = tilesetRef.current
      if (!tileset) return
      usePhoto.getState().patch({
        stats: {
          loaded: tilesLoadedRef.current,
          pending: pendingRequestsRef.current,
          sse: tileset.maximumScreenSpaceError,
        },
      })
    }, 750)
    return () => window.clearInterval(id)
  }, [viewer, active])

  return null
}
