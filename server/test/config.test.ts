import { describe, expect, test } from 'bun:test'
import { parseCorsOrigins } from '../src/config'

/** A hardcoded localhost regex blocked every deployed frontend outright, which
 *  is why this is configurable. The localhost default has to survive, though —
 *  it is what dev and docker-compose both rely on. */
describe('parseCorsOrigins', () => {
  const localhost = () => parseCorsOrigins(undefined) as RegExp

  test('falls back to any localhost port when unset', () => {
    expect(localhost().test('http://localhost:5173')).toBe(true)
    expect(localhost().test('http://127.0.0.1:8787')).toBe(true)
    expect(localhost().test('https://localhost')).toBe(true)
  })

  test('the localhost default does not admit arbitrary origins', () => {
    expect(localhost().test('https://evil.example.com')).toBe(false)
    expect(localhost().test('http://localhost.evil.com')).toBe(false)
  })

  test('an explicit list replaces the default entirely', () => {
    expect(parseCorsOrigins('https://athena.example.com')).toEqual([
      'https://athena.example.com',
    ])
  })

  test('accepts several origins, tolerating spacing and trailing slashes', () => {
    expect(parseCorsOrigins(' https://a.example.com , https://b.example.com/ ')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ])
  })

  test('an empty or blank value is treated as unset rather than as "allow nothing"', () => {
    expect(parseCorsOrigins('')).toBeInstanceOf(RegExp)
    expect(parseCorsOrigins('  ,  ')).toBeInstanceOf(RegExp)
  })
})
