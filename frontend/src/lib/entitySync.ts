import * as Cesium from 'cesium'
import type { RefObject } from 'react'

/** Adds a Cesium Entity for every new id in `items`, removes any previously-added
 *  entity whose id disappeared from `items`. Items are treated as immutable once
 *  placed in this app (no per-item edit UI yet), so this never mutates an existing
 *  entity's graphics -- only add/remove. `entityMapRef` is the caller's own ref
 *  (mutable escape hatch), mirroring the `entityRef` pattern in useRectangleSelection.ts. */
export function syncEntities<T extends { id: string }>(
  viewer: Cesium.Viewer,
  items: T[],
  entityMapRef: RefObject<Map<string, Cesium.Entity>>,
  createEntity: (item: T) => Cesium.Entity.ConstructorOptions,
) {
  const seen = new Set<string>()
  for (const item of items) {
    seen.add(item.id)
    if (!entityMapRef.current.has(item.id)) {
      entityMapRef.current.set(item.id, viewer.entities.add({ id: item.id, ...createEntity(item) }))
    }
  }
  for (const [id, entity] of entityMapRef.current) {
    if (!seen.has(id)) {
      viewer.entities.remove(entity)
      entityMapRef.current.delete(id)
    }
  }
}
