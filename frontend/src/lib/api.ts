import { decodeGrid } from './grid'
import type { BattlegroundMeta, BBoxDeg, GridData, OsmFeatures } from '../types/terrain'

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body.error ?? `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}

export async function createBattleground(bbox: BBoxDeg, name: string): Promise<string> {
  const res = await fetch('/api/battleground', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...bbox, name }),
  })
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { id: string }
  return body.id
}

export async function fetchBattlegroundMeta(
  id: string,
): Promise<{ meta: BattlegroundMeta; features: OsmFeatures }> {
  const res = await fetch(`/api/battleground/${id}/meta`)
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as { meta: BattlegroundMeta; features: OsmFeatures }
}

export async function fetchBattlegroundGrid(id: string, bbox: BBoxDeg): Promise<GridData> {
  const res = await fetch(`/api/battleground/${id}/grid`)
  if (!res.ok) throw new Error(await readError(res))
  return decodeGrid(await res.arrayBuffer(), bbox)
}

export interface DangerObserver {
  longitude: number
  latitude: number
  eyeHeightM?: number
}

/** Cumulative enemy viewshed (0-100 per cell) for the given red-force positions. */
export async function fetchDangerField(id: string, observers: DangerObserver[]): Promise<Uint8Array> {
  const res = await fetch(`/api/battleground/${id}/danger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ observers }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return new Uint8Array(await res.arrayBuffer())
}
