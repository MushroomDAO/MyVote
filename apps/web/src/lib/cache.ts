/**
 * Simple in-memory cache with TTL.
 * Keeps fetched data alive across route navigations; clears on page reload.
 */

type CacheEntry<T> = { data: T; ts: number }

const store = new Map<string, CacheEntry<unknown>>()

const TTL_MS = 5 * 60 * 1000 // 5 minutes

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined
  if (!entry) return null
  if (Date.now() - entry.ts > TTL_MS) {
    store.delete(key)
    return null
  }
  return entry.data
}

export function cacheSet<T>(key: string, data: T): void {
  store.set(key, { data, ts: Date.now() })
}

export function cacheDelete(key: string): void {
  store.delete(key)
}

/**
 * Builds a cache key namespaced by scope (defaults to the current host).
 *
 * The store is per document, but one deployment serves many tenants from the
 * same bundle. A bare key would let one tenant's data be read back under another
 * if a client ever changes tenant without a full reload — namespace it.
 */
export function scopedCacheKey(namespace: string, scope?: string): string {
  const value = scope ?? (typeof window !== 'undefined' ? window.location.host : '')
  return `${namespace}:${value || 'default'}`
}
