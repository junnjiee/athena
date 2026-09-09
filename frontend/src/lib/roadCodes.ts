export type RoadWidth = 2 | 4 | 6
export type RoadType = 'X' | 'Y' | 'Z'

export interface RoadClassification {
  width: RoadWidth
  dual: boolean
  type: RoadType
}

export interface RoadCode extends RoadClassification {
  name: string
}

const WIDTH_BY_CLASS: Record<string, RoadWidth> = {
  motorway: 6,
  trunk: 6,
  primary: 4,
  secondary: 4,
  tertiary: 2,
  residential: 2,
  unclassified: 2,
  service: 2,
  living_street: 2,
  track: 2,
}

function widthFromLanes(lanes: string | null | undefined): RoadWidth | null {
  const counts = lanes?.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) ?? []
  if (counts.length === 0) return null
  const count = Math.max(...counts)
  if (count <= 2) return 2
  if (count <= 4) return 4
  return 6
}

/** A first guess only. OSM lane counts win when present; highway class fills
 *  the gaps. The operator can replace every field in the resulting code. */
export function prefillRoadClassification({
  roadClass,
  lanes,
}: {
  roadClass: string
  lanes?: string | null
}): RoadClassification {
  const width = widthFromLanes(lanes) ?? WIDTH_BY_CLASS[roadClass] ?? 2
  const dual = roadClass === 'motorway' || roadClass === 'trunk'
  const type: RoadType =
    roadClass === 'track'
      ? 'Z'
      : ['motorway', 'trunk', 'primary', 'secondary'].includes(roadClass)
        ? 'X'
        : 'Y'
  return { width, dual, type }
}

/** Parses the confirmed `NAME(<width>[//] <type>)` grammar. */
export function parseRoadCode(value: string): RoadCode | null {
  const match = value.trim().match(/^([^()]+?)\s*\(\s*(2|4|6)(\/\/)?\s+([XYZ])\s*\)$/i)
  if (!match) return null
  return {
    name: match[1].trim().toUpperCase(),
    width: Number(match[2]) as RoadWidth,
    dual: match[3] === '//',
    type: match[4].toUpperCase() as RoadType,
  }
}

export function formatRoadCode({
  name,
  width,
  dual,
  type,
}: Omit<RoadCode, 'type'> & { type: RoadType | Lowercase<RoadType> }): string {
  return `${name.trim().toUpperCase()}(${width}${dual ? '//' : ''} ${type.toUpperCase()})`
}
