import * as Cesium from 'cesium'
import type { RefObject } from 'react'

/** Adds a Cesium Entity for every new id in `items`, removes any previously-added
 *  entity whose id disappeared from `items`, and rebuilds an existing entity
 *  when its backing item's reference changes (move/rotate produce a new object
 *  via spread, so a reference check is enough to detect an edit -- items are
 *  otherwise treated as value objects, never mutated in place). `entityMapRef`
 *  is the caller's own ref (mutable escape hatch), mirroring the `entityRef`
 *  pattern in useRectangleSelection.ts. */
export function syncEntities<T extends { id: string }>(
  viewer: Cesium.Viewer,
  items: T[],
  entityMapRef: RefObject<Map<string, { item: T; entity: Cesium.Entity }>>,
  createEntity: (item: T) => Cesium.Entity.ConstructorOptions,
) {
  const seen = new Set<string>()
  for (const item of items) {
    seen.add(item.id)
    const existing = entityMapRef.current.get(item.id)
    if (!existing) {
      entityMapRef.current.set(item.id, { item, entity: viewer.entities.add({ id: item.id, ...createEntity(item) }) })
    } else if (existing.item !== item) {
      viewer.entities.remove(existing.entity)
      entityMapRef.current.set(item.id, { item, entity: viewer.entities.add({ id: item.id, ...createEntity(item) }) })
    }
  }
  for (const [id, { entity }] of entityMapRef.current) {
    if (!seen.has(id)) {
      viewer.entities.remove(entity)
      entityMapRef.current.delete(id)
    }
  }
}

/** Same add/remove/rebuild diffing as syncEntities, but for items that need more
 *  than one Cesium Entity each (e.g. a ground-vector shape plus separate
 *  echelon-dot points) -- `createEntities` returns one ConstructorOptions per
 *  sub-entity, ids suffixed `${item.id}-0`, `${item.id}-1`, ... */
export function syncEntityGroups<T extends { id: string }>(
  viewer: Cesium.Viewer,
  items: T[],
  entityMapRef: RefObject<Map<string, { item: T; entities: Cesium.Entity[] }>>,
  createEntities: (item: T) => Cesium.Entity.ConstructorOptions[],
) {
  const seen = new Set<string>()
  for (const item of items) {
    seen.add(item.id)
    const existing = entityMapRef.current.get(item.id)
    if (!existing) {
      const entities = createEntities(item).map((options, i) =>
        viewer.entities.add({ id: `${item.id}-${i}`, ...options }),
      )
      entityMapRef.current.set(item.id, { item, entities })
    } else if (existing.item !== item) {
      for (const entity of existing.entities) viewer.entities.remove(entity)
      const entities = createEntities(item).map((options, i) =>
        viewer.entities.add({ id: `${item.id}-${i}`, ...options }),
      )
      entityMapRef.current.set(item.id, { item, entities })
    }
  }
  for (const [id, { entities }] of entityMapRef.current) {
    if (!seen.has(id)) {
      for (const entity of entities) viewer.entities.remove(entity)
      entityMapRef.current.delete(id)
    }
  }
}
