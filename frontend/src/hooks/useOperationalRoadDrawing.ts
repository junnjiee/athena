import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { ACCENT_HEX } from '../lib/colors'
import { pickGroundPosition } from '../lib/pickTerrain'
import type { LonLat } from '../types/entities'

interface Args {
  viewer: Cesium.Viewer | undefined
  active: boolean
  onComplete: (points: LonLat[]) => void
  onCancel: () => void
}

function toLonLat(viewer: Cesium.Viewer, point: Cesium.Cartesian3): LonLat {
  const carto = Cesium.Cartographic.fromCartesian(point, viewer.scene.globe.ellipsoid)
  return {
    longitude: Cesium.Math.toDegrees(carto.longitude),
    latitude: Cesium.Math.toDegrees(carto.latitude),
  }
}

/** Two-click operational-road drawing. The server snaps both endpoints to live
 * junctions; the preview shows the observed line between the operator's picks. */
export function useOperationalRoadDrawing({ viewer, active, onComplete, onCancel }: Args) {
  const startRef = useRef<Cesium.Cartesian3 | null>(null)
  const mouseRef = useRef<Cesium.Cartesian3 | null>(null)
  const previewRef = useRef<Cesium.Entity | null>(null)
  const completeRef = useRef(onComplete)
  const cancelRef = useRef(onCancel)

  useEffect(() => { completeRef.current = onComplete }, [onComplete])
  useEffect(() => { cancelRef.current = onCancel }, [onCancel])

  useEffect(() => {
    if (!viewer || !active) return

    const clear = () => {
      if (previewRef.current && !viewer.isDestroyed()) viewer.entities.remove(previewRef.current)
      previewRef.current = null
      startRef.current = null
      mouseRef.current = null
    }
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const point = pickGroundPosition(viewer, click.position)
      if (!point) return
      if (!startRef.current) {
        startRef.current = point
        previewRef.current = viewer.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(() => {
              if (!startRef.current || !mouseRef.current) return undefined
              return [startRef.current, mouseRef.current]
            }, false),
            width: 4,
            material: Cesium.Color.fromCssColorString(ACCENT_HEX).withAlpha(0.9),
            clampToGround: true,
          },
        })
        return
      }

      const points = [toLonLat(viewer, startRef.current), toLonLat(viewer, point)]
      clear()
      completeRef.current(points)
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (startRef.current) {
        mouseRef.current = pickGroundPosition(viewer, movement.endPosition) ?? null
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      clear()
      cancelRef.current()
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      handler.destroy()
      window.removeEventListener('keydown', onKeyDown)
      clear()
    }
  }, [viewer, active])
}
