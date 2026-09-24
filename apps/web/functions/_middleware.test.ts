// @vitest-environment node
//
// Edge-middleware tests: the /api/graphql proxy, /api/* pass-through, and the
// tenant lookup + window.__TENANT__ injection (field allowlist + escaping).
import { afterEach, describe, expect, it, vi } from 'vitest'

import { onRequest } from './_middleware'

type MiddlewareContext = Parameters<typeof onRequest>[0]

function htmlResponse(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers }
  })
}

function makeContext(request: Request, env: Record<string, unknown>, nextResponse: Response) {
  const next = vi.fn(async () => nextResponse)
  return { request, env, next } as unknown as MiddlewareContext
}

/** Parses the JSON object the middleware injects into the page. */
function injectedTenant(markup: string): Record<string, unknown> {
  const match = markup.match(/window\.__TENANT__=(\{[\s\S]*?\})<\/script>/)
  if (!match) throw new Error('no __TENANT__ script found')
  return JSON.parse(match[1]) as Record<string, unknown>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('_middleware /api/graphql proxy', () => {
  it('proxies to the default testnet hub and returns its response', async () => {
    const fetchMock = vi.fn(async () => new Response('{"data":{}}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new Request('https://bread.test/api/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"query":"{a}"}'
    })
    const response = await onRequest(makeContext(request, {}, new Response('nope')))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://testnet.hub.snapshot.org/graphql')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
    expect(await response.text()).toBe('{"data":{}}')
  })

  it('honours an allowlisted hub and strips trailing slashes', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    const request = new Request('https://bread.test/api/graphql', { method: 'POST' })
    await onRequest(makeContext(request, { SNAPSHOT_HUB: 'https://hub.snapshot.org/' }, new Response('nope')))

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://hub.snapshot.org/graphql')
  })

  it('refuses a non-allowlisted hub without calling fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const request = new Request('https://bread.test/api/graphql', { method: 'POST' })
    const response = await onRequest(makeContext(request, { SNAPSHOT_HUB: 'https://evil.example' }, new Response('nope')))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('not an allowed Snapshot hub')
  })

  it('passes other /api routes to the function handler', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const handled = new Response('{"available":true}', { status: 200 })

    const request = new Request('https://bread.test/api/check?name=bread')
    const context = makeContext(request, {}, handled)
    const response = await onRequest(context)

    expect(context.next).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await response.text()).toBe('{"available":true}')
  })
})

describe('_middleware tenant injection', () => {
  const PAGE = '<html><head><title>x</title></head><body>hi</body></html>'

  function kvReturning(value: unknown) {
    return { get: vi.fn(async () => value) }
  }

  it('leaves non-HTML responses alone and never reads KV', async () => {
    const kv = kvReturning({ name: 'AAStar' })
    const upstream = new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })

    const request = new Request('https://bread.test/')
    const response = await onRequest(makeContext(request, { TENANTS_KV: kv }, upstream))

    expect(kv.get).not.toHaveBeenCalled()
    expect(await response.text()).toBe('{"ok":true}')
  })

  it('injects only the allowlisted fields, before </head>', async () => {
    const kv = kvReturning({
      spaceId: 'aastar.eth',
      name: 'AAStar',
      logo: null,
      colors: { primary: '#ff0000' },
      contactEmail: 'secret@example.com'
    })

    const request = new Request('https://bread.test/')
    const response = await onRequest(makeContext(request, { TENANTS_KV: kv }, htmlResponse(PAGE)))
    const markup = await response.text()

    expect(kv.get).toHaveBeenCalledWith('bread.test', 'json')
    expect(injectedTenant(markup)).toEqual({
      spaceId: 'aastar.eth',
      name: 'AAStar',
      logo: null,
      colors: { primary: '#ff0000' }
    })
    // contactEmail is internal and must never reach the page source.
    expect(markup).not.toContain('secret@example.com')
    expect(markup.indexOf('__TENANT__')).toBeLessThan(markup.indexOf('</head>'))
  })

  it('escapes a tenant value that tries to close the script tag', async () => {
    const kv = kvReturning({ name: '</script><img src=x onerror=alert(1)>' })
    const request = new Request('https://bread.test/')

    const response = await onRequest(makeContext(request, { TENANTS_KV: kv }, htmlResponse(PAGE)))
    const markup = await response.text()

    expect(markup).toContain('\\u003c/script>')
    expect(markup).not.toContain('</script><img')
    expect(injectedTenant(markup).name).toBe('</script><img src=x onerror=alert(1)>')
  })

  it('skips injection when KV has no record for the host', async () => {
    const kv = kvReturning(null)
    const request = new Request('https://bread.test/')

    const response = await onRequest(makeContext(request, { TENANTS_KV: kv }, htmlResponse(PAGE)))

    expect(await response.text()).toBe(PAGE)
  })

  it('skips injection when KV itself throws', async () => {
    const kv = { get: vi.fn(async () => { throw new Error('KV unavailable') }) }
    const request = new Request('https://bread.test/')

    const response = await onRequest(makeContext(request, { TENANTS_KV: kv }, htmlResponse(PAGE)))

    expect(await response.text()).toBe(PAGE)
  })

  it('preserves the upstream status and headers when injecting', async () => {
    const kv = kvReturning({ name: 'AAStar' })
    const request = new Request('https://bread.test/')
    const upstream = htmlResponse(PAGE, 200, { 'x-test': '1' })

    const response = await onRequest(makeContext(request, { TENANTS_KV: kv }, upstream))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-test')).toBe('1')
    expect(await response.text()).toContain('AAStar')
  })
})
