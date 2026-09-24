import { describe, expect, it, vi } from 'vitest'

import { cacheDelete, cacheGet, cacheSet, scopedCacheKey } from './cache'

describe('scopedCacheKey', () => {
  it('namespaces the key by the provided scope', () => {
    expect(scopedCacheKey('explore:spaces', 'a.example')).toBe('explore:spaces:a.example')
  })

  it('falls back to a stable default when the scope is empty', () => {
    expect(scopedCacheKey('explore:spaces', '')).toBe('explore:spaces:default')
  })

  it('does not let two scopes collide', () => {
    expect(scopedCacheKey('k', 'a.example')).not.toBe(scopedCacheKey('k', 'b.example'))
  })
})

describe('cache store', () => {
  it('stores, reads and deletes by key', () => {
    cacheSet('unit:read', { a: 1 })
    expect(cacheGet<{ a: number }>('unit:read')).toEqual({ a: 1 })

    cacheDelete('unit:read')
    expect(cacheGet('unit:read')).toBeNull()
  })

  it('expires an entry after the TTL', () => {
    vi.useFakeTimers()
    try {
      cacheSet('unit:ttl', 'v')
      expect(cacheGet('unit:ttl')).toBe('v')

      vi.advanceTimersByTime(5 * 60 * 1000 + 1)
      expect(cacheGet('unit:ttl')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
