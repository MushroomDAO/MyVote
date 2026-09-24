// @vitest-environment node
//
// Edge-function tests. These run the real handler against a fake KV and a
// stubbed global fetch, so the Workers-specific wiring (rollback, status,
// rate limiting) is exercised rather than only its extracted helpers.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { onRequestPost } from './register'

class FakeKV {
  private map = new Map<string, string>()

  async get(key: string, type?: string): Promise<unknown> {
    const raw = this.map.get(key)
    if (raw === undefined) return null
    return type === 'json' ? JSON.parse(raw) : raw
  }

  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key)
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  raw(key: string): string | undefined {
    return this.map.get(key)
  }
}

const DOMAIN = 'breadshop.forest.mushroom.cv'

function makeContext(body: unknown, env: Record<string, unknown>) {
  return {
    request: new Request('https://example.test/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
      body: JSON.stringify(body)
    }),
    env,
    next: async () => new Response(null)
  } as never
}

function envWith(kv: FakeKV, extra: Record<string, unknown> = {}) {
  return { TENANTS_KV: kv, CF_ROOT_DOMAIN: 'forest.mushroom.cv', ...extra }
}

const CF_ENV = { CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'a', CF_PAGES_PROJECT: 'myvote' }
const validBody = { name: 'breadshop', spaceId: 'ens.eth', email: 'a@example.com' }

function cfResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /api/register', () => {
  it('rejects an invalid spaceId before writing anything', async () => {
    const kv = new FakeKV()
    const res = await onRequestPost(makeContext({ ...validBody, spaceId: 'a/b' }, envWith(kv)))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'spaceId is invalid' })
    expect(kv.has(DOMAIN)).toBe(false)
  })

  it('rejects a missing email', async () => {
    const kv = new FakeKV()
    const res = await onRequestPost(
      makeContext({ name: 'breadshop', spaceId: 'ens.eth' }, envWith(kv))
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'email is required' })
    expect(kv.has(DOMAIN)).toBe(false)
  })

  it('succeeds with domainStatus "unmanaged" when CF credentials are absent', async () => {
    const kv = new FakeKV()
    const res = await onRequestPost(makeContext(validBody, envWith(kv)))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, domainStatus: 'unmanaged' })
    expect(JSON.parse(kv.raw(DOMAIN) ?? '{}').domainStatus).toBe('unmanaged')
  })

  it('marks the domain active when CF registration succeeds', async () => {
    const kv = new FakeKV()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cfResponse({ success: true })))

    const res = await onRequestPost(makeContext(validBody, envWith(kv, CF_ENV)))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, domainStatus: 'active' })
    expect(JSON.parse(kv.raw(DOMAIN) ?? '{}').domainStatus).toBe('active')
  })

  it('rolls the KV write back and returns 502 when CF registration fails', async () => {
    const kv = new FakeKV()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(cfResponse({ success: false, errors: [{ message: 'domain taken' }] }))
    )

    const res = await onRequestPost(makeContext(validBody, envWith(kv, CF_ENV)))

    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ detail: 'domain taken' })
    // The name must be free again — no half-registered tenant left behind.
    expect(kv.has(DOMAIN)).toBe(false)
  })

  it('rate limits repeated attempts with 429', async () => {
    const kv = new FakeKV()
    await kv.put('rl:register:203.0.113.9', '5')

    const res = await onRequestPost(makeContext(validBody, envWith(kv)))

    expect(res.status).toBe(429)
    expect(kv.has(DOMAIN)).toBe(false)
  })
})
