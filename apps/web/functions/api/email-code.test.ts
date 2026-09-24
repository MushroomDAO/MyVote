// @vitest-environment node
//
// Edge-function test for the email verification code endpoint.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { onRequestPost } from './email-code'

class FakeKV {
  private map = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null
  }

  async put(key: string, value: string, _options?: { expirationTtl?: number }): Promise<void> {
    this.map.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key)
  }

  raw(key: string): string | undefined {
    return this.map.get(key)
  }
}

function context(body: unknown, env: Record<string, unknown>) {
  return {
    request: new Request('https://example.test/api/email-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
      body: JSON.stringify(body)
    }),
    env
  } as never
}

const envWith = (kv: FakeKV, extra: Record<string, unknown> = {}) => ({ TENANTS_KV: kv, ...extra })

const resendOk = (id = 'msg-1') =>
  new Response(JSON.stringify({ id }), { status: 200, headers: { 'content-type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

describe('POST /api/email-code', () => {
  it('rejects invalid JSON and a bad address', async () => {
    const kv = new FakeKV()
    const notJson = {
      request: new Request('https://x/api/email-code', { method: 'POST', body: 'not json' }),
      env: envWith(kv)
    } as never
    expect((await onRequestPost(notJson)).status).toBe(400)
    expect((await onRequestPost(context({}, envWith(kv)))).status).toBe(400)
    expect((await onRequestPost(context({ email: 'nope' }, envWith(kv)))).status).toBe(400)
  })

  it('answers 503 when no mail service is configured', async () => {
    const kv = new FakeKV()
    const res = await onRequestPost(context({ email: 'alice@example.com' }, envWith(kv)))
    expect(res.status).toBe(503)
    expect(kv.raw('ec:alice@example.com')).toBeUndefined()
  })

  it('sends a code and stores only its hash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resendOk())
    vi.stubGlobal('fetch', fetchMock)
    const kv = new FakeKV()

    const res = await onRequestPost(
      context({ email: 'Alice@Example.com' }, envWith(kv, { RESEND_API_KEY: 'k' }))
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const sent = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body)
    expect(sent.from).toBe('hello@idoris.ai')
    expect(sent.to).toBe('alice@example.com')
    const code = /<b>(\d{6})<\/b>/.exec(sent.html)?.[1]
    expect(code).toBeTruthy()

    const stored = JSON.parse(kv.raw('ec:alice@example.com')!) as {
      hash: string
      expiresAt: number
      attempts: number
    }
    expect(stored.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.hash).not.toContain(code!)
    expect(stored.attempts).toBe(0)
    expect(stored.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('honours EMAIL_FROM', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resendOk())
    vi.stubGlobal('fetch', fetchMock)
    const kv = new FakeKV()
    await onRequestPost(
      context({ email: 'a@b.com' }, envWith(kv, { RESEND_API_KEY: 'k', EMAIL_FROM: 'noreply@idoris.ai' }))
    )
    const sent = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body)
    expect(sent.from).toBe('noreply@idoris.ai')
  })

  it('rate-limits per address before sending', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resendOk())
    vi.stubGlobal('fetch', fetchMock)
    const kv = new FakeKV()
    const env = envWith(kv, { RESEND_API_KEY: 'k' })

    for (let i = 0; i < 3; i++) {
      expect((await onRequestPost(context({ email: 'a@b.com' }, env))).status).toBe(200)
    }
    expect((await onRequestPost(context({ email: 'a@b.com' }, env))).status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('stores nothing when Resend refuses the message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 422 })))
    const kv = new FakeKV()
    const res = await onRequestPost(context({ email: 'a@b.com' }, envWith(kv, { RESEND_API_KEY: 'k' })))
    expect(res.status).toBe(502)
    expect(kv.raw('ec:a@b.com')).toBeUndefined()
  })

  it('keeps the code when the send outcome is unknown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')))
    const kv = new FakeKV()
    const res = await onRequestPost(context({ email: 'a@b.com' }, envWith(kv, { RESEND_API_KEY: 'k' })))
    expect(res.status).toBe(202)
    expect(kv.raw('ec:a@b.com')).toBeTruthy()
  })
})
