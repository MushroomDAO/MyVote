// @vitest-environment node
//
// Edge-function tests. These run the real handler against a fake KV and a
// stubbed global fetch, so the Workers-specific wiring (rollback, status,
// rate limiting) is exercised rather than only its extracted helpers.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'

import { hashEmailCode } from '../../src/lib/emailCode'
import { buildOwnershipMessage } from '../../src/lib/ownership'
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

// A throwaway key — real signatures, so the viem verification path is exercised.
const ACCOUNT = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
)

async function ownershipProof(domain: string, timestamp: number) {
  return ACCOUNT.signMessage({ message: buildOwnershipMessage(domain, timestamp) })
}

function hubAdmins(admins: string[]) {
  return cfResponse({ data: { space: { admins } } })
}

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
    expect(await res.json()).toMatchObject({
      success: true,
      domainStatus: 'unmanaged',
      ownership: 'unverified'
    })
    expect(JSON.parse(kv.raw(DOMAIN) ?? '{}').domainStatus).toBe('unmanaged')
  })

  it('verifies an ownership proof signed by a space admin', async () => {
    const kv = new FakeKV()
    const timestamp = Date.now()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(hubAdmins([ACCOUNT.address])))

    const res = await onRequestPost(
      makeContext(
        {
          ...validBody,
          adminAddress: ACCOUNT.address,
          adminTimestamp: timestamp,
          adminSignature: await ownershipProof(DOMAIN, timestamp)
        },
        envWith(kv)
      )
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, ownership: 'verified' })
    expect(JSON.parse(kv.raw(DOMAIN) ?? '{}').ownership).toBe('verified')
  })

  it('rejects an ownership proof from a non-admin signer', async () => {
    const kv = new FakeKV()
    const timestamp = Date.now()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(hubAdmins(['0x0000000000000000000000000000000000000001']))
    )

    const res = await onRequestPost(
      makeContext(
        {
          ...validBody,
          adminAddress: ACCOUNT.address,
          adminTimestamp: timestamp,
          adminSignature: await ownershipProof(DOMAIN, timestamp)
        },
        envWith(kv)
      )
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Space ownership proof was rejected' })
    expect(kv.has(DOMAIN)).toBe(false)
  })

  it('rejects a stale ownership proof without contacting the Hub', async () => {
    const kv = new FakeKV()
    const stale = Date.now() - 60 * 60 * 1000
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)

    const res = await onRequestPost(
      makeContext(
        {
          ...validBody,
          adminAddress: ACCOUNT.address,
          adminTimestamp: stale,
          adminSignature: await ownershipProof(DOMAIN, stale)
        },
        envWith(kv)
      )
    )

    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
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

describe('POST /api/register email verification (M6-3)', () => {
  // No CF credentials: the domain stays unmanaged, so the success path needs no network.
  const MAIL_ENV = { RESEND_API_KEY: 'k', EMAIL_CODE_SECRET: 'salt' }

  async function seedCode(
    kv: FakeKV,
    email: string,
    code: string,
    overrides: Record<string, unknown> = {}
  ) {
    await kv.put(
      `ec:${email}`,
      JSON.stringify({
        hash: await hashEmailCode(email, code, 'salt'),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
        attempts: 0,
        ...overrides
      })
    )
  }

  it('requires the emailed code once a mail service is configured', async () => {
    const kv = new FakeKV()
    const res = await onRequestPost(makeContext(validBody, envWith(kv, MAIL_ENV)))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'email_code_missing' })
    expect(kv.has(DOMAIN)).toBe(false)
  })

  it('accepts a valid code, spends it, and marks the record verified', async () => {
    const kv = new FakeKV()
    await seedCode(kv, validBody.email, '123456')

    const res = await onRequestPost(
      makeContext({ ...validBody, emailCode: '123456' }, envWith(kv, MAIL_ENV))
    )

    expect(res.status).toBe(200)
    expect(JSON.parse(kv.raw(DOMAIN) ?? '{}').emailVerified).toBe(true)
    // The code is single-use.
    expect(kv.raw(`ec:${validBody.email}`)).toBeUndefined()
  })

  it('rejects a wrong code and bumps the attempt counter', async () => {
    const kv = new FakeKV()
    await seedCode(kv, validBody.email, '123456')

    const res = await onRequestPost(
      makeContext({ ...validBody, emailCode: '000000' }, envWith(kv, MAIL_ENV))
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'email_code_mismatch' })
    expect(JSON.parse(kv.raw(`ec:${validBody.email}`) ?? '{}').attempts).toBe(1)
    expect(kv.has(DOMAIN)).toBe(false)
  })

  it('rejects an expired code', async () => {
    const kv = new FakeKV()
    await seedCode(kv, validBody.email, '123456', { expiresAt: 1 })

    const res = await onRequestPost(
      makeContext({ ...validBody, emailCode: '123456' }, envWith(kv, MAIL_ENV))
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'email_code_expired' })
  })

  it('stays open without a mail service and records unverified', async () => {
    const kv = new FakeKV()
    const res = await onRequestPost(makeContext(validBody, envWith(kv)))

    expect(res.status).toBe(200)
    expect(JSON.parse(kv.raw(DOMAIN) ?? '{}').emailVerified).toBe(false)
  })
})

