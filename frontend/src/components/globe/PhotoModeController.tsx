import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { useCesium } from 'resium'
import { useBattleground } from '../../state/battleground'
import { usePhoto } from '../../state/photo'
import { createPhotoTileset } from '../../lib/photoTiles'
import { fetchSplatIndex, loadSplatTileset } from '../../lib/splats'
import { measureMeshOffset, type MeshProbe } from '../../lib/photoHeights'
import { sampleCell } from '../../lib/grid'
import type { GridData } from '../../types/terrain'

interface Props {
  /** viewMode === 'photo' */
  active: boolean
}

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
 *  avoids z-fighting between two disagreeing terrains), and vertical
 *  exaggeration is pinned to 1.0 -- it distorts 3D Tiles in cesium 1.143.
 *  Returns the exaggeration to restore on exit. */
function enterPhotoScene(viewer: Cesium.Viewer): number {
  const scene = viewer.scene
  const saved = scene.verticalExaggeration
  scene.globe.show = false
  scene.verticalExaggeration = 1.0
  scene.requestRender()
  return saved
}

function exitPhotoScene(viewer: Cesium.Viewer, savedExaggeration: number): void {
  const scene = viewer.scene
  scene.globe.show = true
  scene.verticalExaggeration = savedExaggeration
  scene.requestRender()
}

function showTilesets(tilesets: readonly (Cesium.Cesium3DTileset | null)[], show: boolean): void {
  for (const tileset of tilesets) {
    if (tileset) tileset.show = show
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

/** Lives inside <Viewer>. Owns the RECON-mode photoreal stack: the Google
 *  Photorealistic 3D Tiles diorama (created hidden + preloading the moment the
 *  battleground is ready, so the Photo toggle does no network on the critical
 *  path) and any gaussian-splat hero tilesets from the server's splat index.
 *  On activation it swaps the scene over and flips marker occlusion (the X-ray
 *  toggle restores see-through). */
export function PhotoModeController({ active }: Props) {
  const { viewer } = useCesium()
  const phase = useBattleground((s) => s.phase)
  const grid = useBattleground((s) => s.grid)
  const xray = usePhoto((s) => s.xray)
  const ready = usePhoto((s) => s.ready)

  const tilesetRef = useRef<Cesium.Cesium3DTileset | null>(null)
  const splatsRef = useRef<Cesium.Cesium3DTileset[]>([])
  const tilesLoadedRef = useRef(0)
  const pendingRequestsRef = useRef(0)

  // --- tileset lifecycle: warm hidden as soon as the battleground is ready ---
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || phase !== 'ready' || !grid) return
    let cancelled = false
    const patch = usePhoto.getState().patch
    tilesLoadedRef.current = 0
    pendingRequestsRef.current = 0
    patch({ warming: true, ready: false, toggleMs: null, meshOffsetM: null, stats: null, splatCount: 0 })

    void createPhotoTileset(grid.bbox)
      .then((tileset) => {
        if (!tileset) {
          patch({ warming: false })
          return
        }
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
          if (!cancelled) usePhoto.getState().patch({ ready: true, warming: false })
        })
      })
      .catch((error: unknown) => {
        patch({ warming: false })
        console.warn('[Athena] photoreal tileset failed to load', error)
      })

    void fetchSplatIndex().then(async (configs) => {
      for (const config of configs) {
        if (cancelled) return
        try {
          const tileset = await loadSplatTileset(config)
          if (!tileset) continue
          if (cancelled || viewer.isDestroyed()) return
          attachTileset(viewer, tileset, usePhoto.getState().active)
          splatsRef.current = [...splatsRef.current, tileset]
          usePhoto.getState().patch({ splatCount: splatsRef.current.length })
        } catch (error: unknown) {
          console.warn(`[Athena] splat "${config.name}" failed to load`, error)
        }
      }
    })

    return () => {
      cancelled = true
      if (!viewer.isDestroyed()) {
        // primitives.remove destroys by default
        if (tilesetRef.current) viewer.scene.primitives.remove(tilesetRef.current)
        for (const splat of splatsRef.current) viewer.scene.primitives.remove(splat)
      }
      tilesetRef.current = null
      splatsRef.current = []
      usePhoto.getState().patch({ warming: false, ready: false, stats: null, splatCount: 0 })
    }
  }, [viewer, phase, grid])

  // --- activation: swap the scene over, measure time-to-first-photon ---------
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    const patch = usePhoto.getState().patch
    patch({ active })
    if (!active) return

    const savedExaggeration = enterPhotoScene(viewer)
    const tileset = tilesetRef.current
    showTilesets([tileset, ...splatsRef.current], true)
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
      exitPhotoScene(viewer, savedExaggeration)
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
