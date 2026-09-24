import { describe, expect, it } from 'vitest'

import {
  claimDomain,
  releaseDomain,
  reserveByKv,
  type TenantRegistryNamespace
} from './tenantRegistry'

/**
 * In-memory stand-in for the Durable Object. Requests are queued on a promise
 * chain so this fake serialises exactly like the real object does — the fake is
 * not the guarantee, the DO is, but the queue keeps the tests honest about it.
 */
function fakeRegistry() {
  const held = new Map<string, string>()
  let tail: Promise<unknown> = Promise.resolve()

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const body = (await request.json()) as { domain: string; token: string }
    if (url.pathname === '/claim') {
      if (held.has(body.domain)) return Response.json({ ok: false, taken: true })
      held.set(body.domain, body.token)
      return Response.json({ ok: true })
    }
    if (held.get(body.domain) === body.token) held.delete(body.domain)
    return Response.json({ ok: true })
  }

  const namespace: TenantRegistryNamespace = {
    idFromName: (name) => name,
    get: () => ({
      fetch: (request: Request) => {
        const run = tail.then(() => handle(request))
        tail = run.then(
          () => undefined,
          () => undefined
        )
        return run
      }
    })
  }
  return { namespace, held }
}

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

  raw(key: string): string | undefined {
    return this.map.get(key)
  }
}

const DOMAIN = 'breadshop.forest.mushroom.cv'

describe('claimDomain', () => {
  it('lets exactly one of two concurrent claims for a name win', async () => {
    const { namespace } = fakeRegistry()
    const results = await Promise.all([
      claimDomain(namespace, DOMAIN, 'token-a'),
      claimDomain(namespace, DOMAIN, 'token-b')
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('reports a second claim for a held name as taken', async () => {
    const { namespace } = fakeRegistry()
    expect(await claimDomain(namespace, DOMAIN, 'token-a')).toBe(true)
    expect(await claimDomain(namespace, DOMAIN, 'token-b')).toBe(false)
  })

  it('surfaces a registry failure instead of silently claiming', async () => {
    const namespace: TenantRegistryNamespace = {
      idFromName: (name) => name,
      get: () => ({ fetch: async () => new Response('boom', { status: 500 }) })
    }
    await expect(claimDomain(namespace, DOMAIN, 'token-a')).rejects.toThrow('500')
  })
})

describe('releaseDomain', () => {
  it('keeps a claim that belongs to another token', async () => {
    const { namespace, held } = fakeRegistry()
    await claimDomain(namespace, DOMAIN, 'token-a')
    await releaseDomain(namespace, DOMAIN, 'token-b')
    expect(held.get(DOMAIN)).toBe('token-a')
  })

  it('frees the name for a retry when the holder releases it', async () => {
    const { namespace } = fakeRegistry()
    await claimDomain(namespace, DOMAIN, 'token-a')
    await releaseDomain(namespace, DOMAIN, 'token-a')
    expect(await claimDomain(namespace, DOMAIN, 'token-b')).toBe(true)
  })

  it('swallows a registry failure so it cannot mask the original error', async () => {
    const namespace: TenantRegistryNamespace = {
      idFromName: (name) => name,
      get: () => ({
        fetch: async () => {
          throw new Error('registry down')
        }
      })
    }
    await expect(releaseDomain(namespace, DOMAIN, 'token-a')).resolves.toBeUndefined()
  })
})

describe('reserveByKv (fallback when the Durable Object is not bound)', () => {
  it('writes the reservation and confirms it', async () => {
    const kv = new FakeKV()
    expect(await reserveByKv(kv as never, DOMAIN, 'token-a')).toBe(true)
    expect(JSON.parse(kv.raw(DOMAIN) ?? '{}')._reservation).toBe('token-a')
  })
})
