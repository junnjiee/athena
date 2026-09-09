import type { RoadTheme } from '../types/routeStudy'

interface ThemeName {
  name: string
  /** Curated rather than guessed in code: pronunciation is an operator concern. */
  syllables: 2
}

interface RoadThemeDefinition {
  label: string
  names: readonly ThemeName[]
}

function two(name: string): ThemeName {
  return { name, syllables: 2 }
}

/** Distinct lists keep neighbouring AOs distinguishable when their operators
 *  select different themes. Every entry is deliberately two syllables. */
export const ROAD_THEMES: Record<RoadTheme, RoadThemeDefinition> = {
  raptors: {
    label: 'Birds of prey',
    names: ['FALCON', 'KESTREL', 'OSPREY', 'EAGLE', 'CONDOR', 'BUZZARD', 'MERLIN', 'VULTURE'].map(two),
  },
  'big-cats': {
    label: 'Big cats',
    names: ['TIGER', 'COUGAR', 'PUMA', 'PANTHER', 'LEOPARD', 'CHEETAH', 'BOBCAT', 'LION'].map(two),
  },
  weather: {
    label: 'Weather',
    names: ['THUNDER', 'LIGHTNING', 'TEMPEST', 'CYCLONE', 'MONSOON', 'BLIZZARD', 'TYPHOON', 'DOWNPOUR'].map(two),
  },
  trees: {
    label: 'Trees',
    names: ['CEDAR', 'MAPLE', 'WILLOW', 'ASPEN', 'CYPRESS', 'REDWOOD', 'BANYAN', 'LAUREL', 'POPLAR', 'HEMLOCK'].map(two),
  },
}

/** Returns the next unused call sign in the operator's chosen theme. A finite
 *  curated list is safer than inventing names whose spoken shape is unknown. */
export function nextRoadName(theme: RoadTheme, usedNames: Iterable<string>): string | null {
  const used = new Set([...usedNames].map((name) => name.trim().toUpperCase()))
  return ROAD_THEMES[theme].names.find((entry) => !used.has(entry.name))?.name ?? null
}
