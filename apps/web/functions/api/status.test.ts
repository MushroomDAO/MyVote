// @vitest-environment node
//
// Edge-function test for the public status endpoint.
import { describe, expect, it } from 'vitest'

import { onRequestGet } from './status'

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

function ctx(name: string | null, env: Record<string, unknown>) {
  const url =
    name === null ? 'https://example.test/api/status' : 'https://example.test/api/status?name=' + name
  return { request: new Request(url), env, next: async () => new Response(null) } as never
}

describe('GET /api/status', () => {
  it('requires a name', async () => {
    const res = await onRequestGet(ctx(null, ENV()))
    expect(res.status).toBe(400)
  })

  it('reports a missing tenant', async () => {
    const res = await onRequestGet(ctx('nope', ENV()))
    expect(await res.json()).toMatchObject({ exists: false, domain: 'nope.forest.mushroom.cv' })
  })

  it('returns the tenant config including ownership and domain status', async () => {
    const env = ENV()
    const kv = env.TENANTS_KV as FakeKV
    await kv.put(
      'bread.forest.mushroom.cv',
      JSON.stringify({
        spaceId: 'ens.eth',
        name: 'bread',
        ownership: 'verified',
        domainStatus: 'active',
        createdAt: '2026-01-01T00:00:00.000Z'
      })
    )

    const res = await onRequestGet(ctx('bread', env))

    expect(await res.json()).toMatchObject({
      exists: true,
      spaceId: 'ens.eth',
      ownership: 'verified',
      domainStatus: 'active'
    })
  })
})
