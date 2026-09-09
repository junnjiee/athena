import { describe, expect, test } from 'bun:test'
import {
  effectivePlatformCount,
  establishmentFraction,
  formatEffectiveCount,
  orderedTaskOrganization,
} from '../src/lib/reserveComposition'

describe('fractional-third formation modifiers', () => {
  test('maps every doctrinal modifier to exact thirds', () => {
    expect(establishmentFraction('=')).toEqual({ numerator: 1, denominator: 3 })
    expect(establishmentFraction('-')).toEqual({ numerator: 2, denominator: 3 })
    expect(establishmentFraction('full')).toEqual({ numerator: 3, denominator: 3 })
    expect(establishmentFraction('+')).toEqual({ numerator: 4, denominator: 3 })
  })

  test('keeps non-integral platform counts exact instead of rounding', () => {
    expect(effectivePlatformCount(10, '-')).toEqual({ numerator: 20, denominator: 3 })
    expect(formatEffectiveCount(10, '-')).toBe('20/3')
    expect(formatEffectiveCount(9, '=')).toBe('3')
  })

  test('orders convoy elements explicitly, not by echelon or strength', () => {
    const elements = [
      { id: 'abg', designation: 'ABG', echelon: 'battalion' as const, modifier: '-' as const, order_of_move: 2, platforms: [] },
      { id: 'drc', designation: 'DRC', echelon: 'company' as const, modifier: 'full' as const, order_of_move: 1, platforms: [] },
    ]
    expect(orderedTaskOrganization(elements).map((element) => element.id)).toEqual(['drc', 'abg'])
  })
})
