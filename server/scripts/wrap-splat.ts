/**
 * Wrap a locally-modeled gaussian-splat glb (e.g. a SuperSplat export of a
 * Polycam/Luma/Scaniverse capture) into a minimal, self-hosted 3D Tiles
 * tileset georeferenced at a lon/lat/height.
 *
 * Usage:
 *   bun scripts/wrap-splat.ts --name objective-block --model ~/Downloads/capture.glb \
 *     --lon 103.7185 --lat 1.3092 --height 25 --radius 80
 *
 * Writes assets/splats/<name>/{model.glb,tileset.json} and prints the
 * index.json entry to register it.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { enuToEcefMatrix } from '../src/lib/enu'

interface Args {
  name: string
  model: string
  lon: number
  lat: number
  height: number
  radius: number
  heading: number
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(`--${flag}`)
    return i !== -1 ? argv[i + 1] : undefined
  }
  const required = (flag: string): string => {
    const value = get(flag)
    if (value === undefined) throw new Error(`missing --${flag}`)
    return value
  }
  const number = (flag: string, fallback?: number): number => {
    const raw = get(flag)
    if (raw === undefined) {
      if (fallback !== undefined) return fallback
      throw new Error(`missing --${flag}`)
    }
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) throw new Error(`--${flag} must be a number, got "${raw}"`)
    return parsed
  }
  return {
    name: required('name'),
    model: required('model'),
    lon: number('lon'),
    lat: number('lat'),
    height: number('height'),
    radius: number('radius', 100),
    heading: number('heading', 0),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const splatsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/splats')
  const outDir = path.join(splatsRoot, args.name)
  await fs.mkdir(outDir, { recursive: true })
  await fs.copyFile(args.model, path.join(outDir, 'model.glb'))

  // heading is applied at runtime via the index placement; the baked transform
  // is a plain ENU frame so the asset can be re-aimed without re-wrapping
  const tileset = {
    asset: { version: '1.1' },
    geometricError: args.radius * 2,
    root: {
      transform: enuToEcefMatrix(args.lon, args.lat, args.height),
      boundingVolume: { sphere: [0, 0, 0, args.radius] },
      geometricError: 0,
      refine: 'ADD',
      content: { uri: 'model.glb' },
    },
  }
  await fs.writeFile(path.join(outDir, 'tileset.json'), JSON.stringify(tileset, null, 2))

  const indexEntry = {
    name: args.name,
    path: `${args.name}/tileset.json`,
    ...(args.heading !== 0
      ? { placement: { lon: args.lon, lat: args.lat, heightM: args.height, headingDeg: args.heading } }
      : {}),
  }
  process.stdout.write(
    `wrote ${outDir}\n\nadd to assets/splats/index.json:\n${JSON.stringify([indexEntry], null, 2)}\n`,
  )
}

await main()
