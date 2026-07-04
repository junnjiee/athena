/** Minimal LRU built on Map's insertion-order iteration. Values are treated as
 *  immutable by convention — the cache never clones. */
export class LruCache<V> {
  private readonly map = new Map<string, V>()

  constructor(private readonly maxEntries: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key)
    if (value === undefined) return undefined
    // refresh recency
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  get size(): number {
    return this.map.size
  }
}
