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
