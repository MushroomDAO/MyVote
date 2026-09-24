import { describe, expect, it } from 'vitest'

import { hitRateLimit, type KVLike } from './rateLimit'

function fakeKV() {
  const map = new Map<string, string>()
  const kv: KVLike = {
    async get(key) {
      return map.get(key) ?? null
    },
    async put(key, value) {
      map.set(key, value)
    }
  }
  return { kv, map }
}

describe('hitRateLimit', () => {
  it('allows requests up to the limit, then blocks', async () => {
    const { kv } = fakeKV()

    for (let i = 1; i <= 3; i += 1) {
      const result = await hitRateLimit(kv, 'rl:test', 3, 60)
      expect(result.limited).toBe(false)
      expect(result.count).toBe(i)
    }

    const blocked = await hitRateLimit(kv, 'rl:test', 3, 60)
    expect(blocked.limited).toBe(true)
    expect(blocked.count).toBe(3)
  })

  it('keeps counters independent per key', async () => {
    const { kv } = fakeKV()
    await hitRateLimit(kv, 'rl:a', 1, 60)
    const other = await hitRateLimit(kv, 'rl:b', 1, 60)
    expect(other.limited).toBe(false)
  })

  it('treats a corrupt counter as zero', async () => {
    const { kv, map } = fakeKV()
    map.set('rl:bad', 'not-a-number')
    const result = await hitRateLimit(kv, 'rl:bad', 2, 60)
    expect(result.limited).toBe(false)
    expect(result.count).toBe(1)
  })
})
