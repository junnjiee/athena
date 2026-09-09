import type { CompositionModifier, TaskOrganizationElement } from '../types/routeStudy'

const MODIFIER_THIRDS: Record<CompositionModifier, number> = {
  '=': 1,
  '-': 2,
  full: 3,
  '+': 4,
}

export const MODIFIER_LABEL: Record<CompositionModifier, string> = {
  '=': '(=) · 1/3 est.',
  '-': '(-) · 2/3 est.',
  full: 'Full · 3/3 est.',
  '+': '(+) · 4/3 est.',
}

export function establishmentFraction(modifier: CompositionModifier): { numerator: number; denominator: 3 } {
  return { numerator: MODIFIER_THIRDS[modifier], denominator: 3 }
}

/** Exact effective platform count as a reduced fraction. Never round a reduced
 *  headquarters into another echelon just because the resulting count is small. */
export function effectivePlatformCount(
  establishmentCount: number,
  modifier: CompositionModifier,
): { numerator: number; denominator: number } {
  let numerator = Math.max(0, Math.trunc(establishmentCount)) * MODIFIER_THIRDS[modifier]
  let denominator = 3
  const divisor = numerator % 3 === 0 ? 3 : 1
  numerator /= divisor
  denominator /= divisor
  return { numerator, denominator }
}

export function orderedTaskOrganization(elements: TaskOrganizationElement[]): TaskOrganizationElement[] {
  return [...elements].sort((a, b) => a.order_of_move - b.order_of_move || a.designation.localeCompare(b.designation))
}

export function formatEffectiveCount(establishmentCount: number, modifier: CompositionModifier): string {
  const { numerator, denominator } = effectivePlatformCount(establishmentCount, modifier)
  return denominator === 1 ? String(numerator) : `${numerator}/${denominator}`
}
