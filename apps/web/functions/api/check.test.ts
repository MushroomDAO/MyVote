// @vitest-environment node
//
// Edge-function test for the public availability endpoint.
import { describe, expect, it } from 'vitest'

import { onRequestGet } from './check'

class FakeKV {
  private map = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null
  }

  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value)
  }
}

const ENV = () => ({ TENANTS_KV: new FakeKV(), CF_ROOT_DOMAIN: 'forest.mushroom.cv' })

function ctx(query: string, env: Record<string, unknown>) {
  return {
    request: new Request('https://example.test/api/check' + query),
    env,
    next: async () => new Response(null)
  } as never
}

describe('GET /api/check', () => {
  it('requires a name', async () => {
    const res = await onRequestGet(ctx('', ENV()))
    expect(res.status).toBe(400)
  })

  it('rejects an invalid name', async () => {
    const res = await onRequestGet(ctx('?name=ab', ENV()))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('3–30') })
  })

  it('reports an unused name as available', async () => {
    const res = await onRequestGet(ctx('?name=bread', ENV()))
    expect(await res.json()).toMatchObject({
      available: true,
      domain: 'bread.forest.mushroom.cv',
      name: 'bread'
    })
  })

  it('reports a taken name as unavailable', async () => {
    const env = ENV()
    await (env.TENANTS_KV as FakeKV).put('bread.forest.mushroom.cv', '{}')

    const res = await onRequestGet(ctx('?name=bread', env))

    expect(await res.json()).toMatchObject({ available: false })
  })

  it('rate limits with 429 once the window is exhausted', async () => {
    const env = ENV()
    // Requests carry no CF-Connecting-IP in tests, so the key is the fallback.
    await (env.TENANTS_KV as FakeKV).put('rl:check:unknown', '120')

    const res = await onRequestGet(ctx('?name=bread', env))

    expect(res.status).toBe(429)
  })
})
