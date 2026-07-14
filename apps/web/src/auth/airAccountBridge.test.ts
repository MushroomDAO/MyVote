import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAirAccountBridge,
  REDIRECT_URI_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  SsoCodeRejectedError,
  SsoNoSessionError,
  SsoRedirectingError,
  type AirAccountBridgeOptions,
  type SsoSession
} from './airAccountBridge'
import { KmsNotConfiguredError } from './kms'

const API_BASE = 'https://cos72.test/api/v1'
const AUTHORIZE_URL = 'https://cos72.test/sso/start'
const CODE = 'a'.repeat(64)
const AA_ADDRESS = '0x1111111111111111111111111111111111111111'
const APP_URL = 'https://myvote.test/proposal/0xabc'
const REDIRECT_URI = 'https://myvote.test/proposal/0xabc'

/** In-memory Storage stand-in. */
function createStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

type Harness = {
  /** The SSO session + pending redirect_uri live here (sessionStorage, not localStorage). */
  session: ReturnType<typeof createStorage>
  fetchImpl: ReturnType<typeof vi.fn>
  navigate: ReturnType<typeof vi.fn>
  url: { current: string }
  now: { current: number }
  options: AirAccountBridgeOptions
}

function createHarness(initialUrl = APP_URL): Harness {
  const session = createStorage()
  const fetchImpl = vi.fn()
  const navigate = vi.fn()
  const url = { current: initialUrl }
  const now = { current: 1_700_000_000_000 }

  return {
    session,
    fetchImpl,
    navigate,
    url,
    now,
    options: {
      apiBase: API_BASE,
      authorizeUrl: AUTHORIZE_URL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sessionStorage: session,
      getUrl: () => url.current,
      replaceUrl: (next: string) => {
        url.current = next
      },
      navigate,
      now: () => now.current
    }
  }
}

function readSession(h: Harness): SsoSession {
  const raw = h.session.getItem(SESSION_STORAGE_KEY)
  if (!raw) throw new Error('no session stored')
  return JSON.parse(raw) as SsoSession
}

/** Stores a live session directly, as a prior login would have. */
function storeSession(h: Harness, expiresInMs = 600_000, token = 'jwt-1') {
  h.session.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ token, aaAddress: AA_ADDRESS, expiresAt: h.now.current + expiresInMs })
  )
}

describe('AirAccount bridge — code exchange', () => {
  let h: Harness

  beforeEach(() => {
    h = createHarness(`${APP_URL}?code=${CODE}`)
  })

  it('exchanges the code, persists the session, and strips the code from the URL', async () => {
    h.session.setItem(REDIRECT_URI_STORAGE_KEY, REDIRECT_URI)
    h.fetchImpl.mockResolvedValueOnce(
      jsonResponse({ token: 'jwt-1', aaAddress: AA_ADDRESS, expiresIn: 600 })
    )

    const user = await createAirAccountBridge(h.options).connect()

    expect(user.address).toBe(AA_ADDRESS)

    const [calledUrl, init] = h.fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe(`${API_BASE}/sso/exchange`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ code: CODE, redirect_uri: REDIRECT_URI })

    expect(readSession(h)).toEqual({
      token: 'jwt-1',
      aaAddress: AA_ADDRESS,
      expiresAt: h.now.current + 600 * 1000
    })

    // Single-use code scrubbed; pending redirect_uri cleared.
    expect(h.url.current).toBe(APP_URL)
    expect(h.session.getItem(REDIRECT_URI_STORAGE_KEY)).toBeNull()
  })

  it('falls back to origin+path when no redirect_uri was stashed', async () => {
    h.fetchImpl.mockResolvedValueOnce(
      jsonResponse({ token: 'jwt-1', aaAddress: AA_ADDRESS, expiresIn: 600 })
    )

    await createAirAccountBridge(h.options).connect()

    const [, init] = h.fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string).redirect_uri).toBe(REDIRECT_URI)
  })

  it('preserves other query params and the hash when stripping the code', async () => {
    h.url.current = `https://myvote.test/proposal/0xabc?code=${CODE}&ref=x#frag`
    h.fetchImpl.mockResolvedValueOnce(
      jsonResponse({ token: 'jwt-1', aaAddress: AA_ADDRESS, expiresIn: 600 })
    )

    await createAirAccountBridge(h.options).connect()

    expect(h.url.current).toBe('https://myvote.test/proposal/0xabc?ref=x#frag')
  })

  it('dedupes concurrent connects so the single-use code is only spent once', async () => {
    h.fetchImpl.mockResolvedValue(
      jsonResponse({ token: 'jwt-1', aaAddress: AA_ADDRESS, expiresIn: 600 })
    )

    const bridge = createAirAccountBridge(h.options)
    const [a, b] = await Promise.all([bridge.connect(), bridge.restore()])

    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
    expect(a.address).toBe(AA_ADDRESS)
    expect(b.address).toBe(AA_ADDRESS)
  })

  it('rejects a malformed code without calling the API', async () => {
    h.url.current = `${APP_URL}?code=not-a-valid-code`

    await expect(createAirAccountBridge(h.options).restore()).rejects.toThrow(SsoNoSessionError)
    expect(h.fetchImpl).not.toHaveBeenCalled()
  })
})

/**
 * H2: a dead code must not become a trap. cos72 answers 401 for
 * invalid/expired/spent/redirect-mismatch alike, so a 4xx means "start over" —
 * whereas a network blip or 5xx means "try that same code again".
 */
describe('AirAccount bridge — dead code vs retryable failure', () => {
  let h: Harness

  beforeEach(() => {
    h = createHarness(`${APP_URL}?code=${CODE}`)
    h.session.setItem(REDIRECT_URI_STORAGE_KEY, REDIRECT_URI)
  })

  it('scrubs the code from the URL when cos72 rejects it (4xx), breaking the retry loop', async () => {
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 401))

    const bridge = createAirAccountBridge(h.options)

    await expect(bridge.connect()).rejects.toThrow(SsoCodeRejectedError)

    // The trap we're avoiding: code still in URL => hasSession() true => wallet
    // stays disabled => every retry burns the same dead code.
    expect(h.url.current).toBe(APP_URL)
    expect(h.url.current).not.toContain('code=')
    expect(h.session.getItem(REDIRECT_URI_STORAGE_KEY)).toBeNull()
    expect(h.session.getItem(SESSION_STORAGE_KEY)).toBeNull()
    expect(bridge.hasSession()).toBe(false)
  })

  it('keeps the code for a retry when cos72 is down (5xx)', async () => {
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 503))

    const bridge = createAirAccountBridge(h.options)

    await expect(bridge.connect()).rejects.not.toBeInstanceOf(SsoCodeRejectedError)
    expect(h.url.current).toContain(`code=${CODE}`)
    expect(h.session.getItem(REDIRECT_URI_STORAGE_KEY)).toBe(REDIRECT_URI)
  })

  it('keeps the code for a retry on a network error', async () => {
    h.fetchImpl.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(createAirAccountBridge(h.options).connect()).rejects.toThrow(/SSO 交换请求失败/)
    expect(h.url.current).toContain(`code=${CODE}`)
  })

  it('treats a malformed exchange response as a dead code', async () => {
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ token: 'jwt-1', expiresIn: 600 }))

    await expect(createAirAccountBridge(h.options).connect()).rejects.toThrow(SsoCodeRejectedError)
    expect(h.session.getItem(SESSION_STORAGE_KEY)).toBeNull()
    expect(h.url.current).not.toContain('code=')
  })
})

/**
 * H1: a brand-new user has no code and no session. Clicking Login must send them
 * to cos72 — MyVote cannot mint a code itself (POST /sso/authorize is behind
 * cos72's JwtAuthGuard).
 */
describe('AirAccount bridge — first-time login redirect', () => {
  it('connect() with no code and no session redirects to cos72 with the redirect_uri', async () => {
    const h = createHarness()

    const bridge = createAirAccountBridge(h.options)

    await expect(bridge.connect()).rejects.toThrow(SsoRedirectingError)

    expect(h.navigate).toHaveBeenCalledTimes(1)
    const [navigatedTo] = h.navigate.mock.calls[0] as [string]
    const target = new URL(navigatedTo)
    expect(target.origin + target.pathname).toBe(AUTHORIZE_URL)
    expect(target.searchParams.get('redirect_uri')).toBe(REDIRECT_URI)

    // The exact redirect_uri is stashed so /sso/exchange can echo it back verbatim.
    expect(h.session.getItem(REDIRECT_URI_STORAGE_KEY)).toBe(REDIRECT_URI)
    expect(h.fetchImpl).not.toHaveBeenCalled()
  })

  it('restore() never redirects — an anonymous visitor is not bounced to cos72', async () => {
    const h = createHarness()

    await expect(createAirAccountBridge(h.options).restore()).rejects.toThrow(SsoNoSessionError)

    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('redirects to login when the stored session is definitively rejected', async () => {
    const h = createHarness()
    storeSession(h)
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ valid: false }))

    await expect(createAirAccountBridge(h.options).connect()).rejects.toThrow(SsoRedirectingError)

    expect(h.navigate).toHaveBeenCalledTimes(1)
    expect(h.session.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('raises a clear config error when no authorize URL is set', async () => {
    const h = createHarness()

    const bridge = createAirAccountBridge({ ...h.options, authorizeUrl: '' })

    await expect(bridge.connect()).rejects.toThrow(/VITE_COS72_AUTHORIZE_URL/)
    expect(h.navigate).not.toHaveBeenCalled()
  })
})

/**
 * L1: GET /sso/verify never throws on a bad token — it answers 200 {valid:false}.
 * So a non-2xx means cos72 is unreachable, NOT that our token died. Never destroy
 * a good session over a blip.
 */
describe('AirAccount bridge — session restore via /sso/verify', () => {
  let h: Harness

  beforeEach(() => {
    h = createHarness()
  })

  it('restores a stored session after the server confirms the token', async () => {
    storeSession(h)
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ valid: true, aaAddress: AA_ADDRESS }))

    const user = await createAirAccountBridge(h.options).restore()

    expect(user.address).toBe(AA_ADDRESS)

    const [calledUrl, init] = h.fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe(`${API_BASE}/sso/verify`)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1')
  })

  it('adopts the server aaAddress over the cached one', async () => {
    storeSession(h)
    const serverAddress = '0x2222222222222222222222222222222222222222'
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ valid: true, aaAddress: serverAddress }))

    const user = await createAirAccountBridge(h.options).restore()

    expect(user.address).toBe(serverAddress)
    expect(readSession(h).aaAddress).toBe(serverAddress)
  })

  it('clears the session when the server answers valid:false', async () => {
    storeSession(h)
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ valid: false }))

    await expect(createAirAccountBridge(h.options).restore()).rejects.toThrow(SsoCodeRejectedError)
    expect(h.session.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('KEEPS the session when verify 5xxs — a server blip must not log the user out', async () => {
    storeSession(h)
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 503))

    const bridge = createAirAccountBridge(h.options)

    await expect(bridge.restore()).rejects.not.toBeInstanceOf(SsoCodeRejectedError)
    expect(h.session.getItem(SESSION_STORAGE_KEY)).not.toBeNull()
    expect(bridge.getSession()?.token).toBe('jwt-1')
  })

  it('KEEPS the session when verify fails with a network error', async () => {
    storeSession(h)
    h.fetchImpl.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const bridge = createAirAccountBridge(h.options)

    await expect(bridge.restore()).rejects.toThrow(/SSO 校验请求失败/)
    expect(bridge.getSession()?.token).toBe('jwt-1')
  })

  it('clears the session on an explicit 401', async () => {
    storeSession(h)
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))

    await expect(createAirAccountBridge(h.options).restore()).rejects.toThrow(SsoCodeRejectedError)
    expect(h.session.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('drops a corrupt stored session instead of wedging login', async () => {
    h.session.setItem(SESSION_STORAGE_KEY, '{not json')

    await expect(createAirAccountBridge(h.options).restore()).rejects.toThrow(SsoNoSessionError)
    expect(h.session.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })
})

describe('AirAccount bridge — expiry and storage', () => {
  let h: Harness

  beforeEach(() => {
    h = createHarness()
  })

  it('M1: the token lives in sessionStorage, not localStorage', async () => {
    const h2 = createHarness(`${APP_URL}?code=${CODE}`)
    h2.fetchImpl.mockResolvedValueOnce(
      jsonResponse({ token: 'jwt-1', aaAddress: AA_ADDRESS, expiresIn: 600 })
    )

    await createAirAccountBridge(h2.options).connect()

    // The harness only wires sessionStorage; the session must land there.
    expect(h2.session.getItem(SESSION_STORAGE_KEY)).toContain('jwt-1')
  })

  it('survives a reload while the token is still live (same tab)', () => {
    storeSession(h)

    const bridge = createAirAccountBridge(h.options)

    expect(bridge.hasSession()).toBe(true)
    expect(bridge.getSession()?.token).toBe('jwt-1')
  })

  it('treats an expired session as absent and purges it', async () => {
    storeSession(h)
    h.now.current += 601_000 // past the 10min TTL

    const bridge = createAirAccountBridge(h.options)

    expect(bridge.getSession()).toBeNull()
    expect(bridge.hasSession()).toBe(false)
    expect(h.session.getItem(SESSION_STORAGE_KEY)).toBeNull()

    await expect(bridge.restore()).rejects.toThrow(SsoNoSessionError)
    expect(h.fetchImpl).not.toHaveBeenCalled()
  })

  it('expires early by the skew window, so a token never dies mid-request', () => {
    storeSession(h, 3_000) // inside the 5s skew

    expect(createAirAccountBridge(h.options).getSession()).toBeNull()
  })

  it('reports a session when a code is in the URL, even with nothing stored', () => {
    h.url.current = `${APP_URL}?code=${CODE}`

    expect(createAirAccountBridge(h.options).hasSession()).toBe(true)
  })

  it('disconnect clears the session and the pending redirect_uri', async () => {
    storeSession(h)
    h.session.setItem(REDIRECT_URI_STORAGE_KEY, REDIRECT_URI)

    const bridge = createAirAccountBridge(h.options)
    await bridge.disconnect()

    expect(h.session.getItem(SESSION_STORAGE_KEY)).toBeNull()
    expect(h.session.getItem(REDIRECT_URI_STORAGE_KEY)).toBeNull()
    expect(bridge.hasSession()).toBe(false)
  })
})

describe('AirAccount bridge — login preparation and signing', () => {
  it('prepareLogin stores a query/hash-free redirect_uri', () => {
    const h = createHarness(`${APP_URL}?foo=1#bar`)

    const redirectUri = createAirAccountBridge(h.options).prepareLogin()

    expect(redirectUri).toBe(REDIRECT_URI)
    expect(h.session.getItem(REDIRECT_URI_STORAGE_KEY)).toBe(REDIRECT_URI)
  })

  it('signing delegates to the KMS with the session token and address', async () => {
    const h = createHarness()
    storeSession(h)
    const signTypedData = vi.fn().mockResolvedValue('0xdeadbeef')

    const bridge = createAirAccountBridge({
      ...h.options,
      kms: { signTypedData, signMessage: vi.fn() }
    })
    const typedData = { domain: {}, types: {}, primaryType: 'Vote', message: {} }
    const sig = await bridge.signTypedData({ address: AA_ADDRESS, typedData })

    expect(sig).toBe('0xdeadbeef')
    expect(signTypedData).toHaveBeenCalledWith({
      aaAddress: AA_ADDRESS,
      token: 'jwt-1',
      typedData
    })
  })

  it('refuses to sign for an address that is not the session account', async () => {
    const h = createHarness()
    storeSession(h)

    await expect(
      createAirAccountBridge(h.options).signTypedData({
        address: '0x9999999999999999999999999999999999999999',
        typedData: {}
      })
    ).rejects.toThrow(/不匹配/)
  })

  it('refuses to sign once the session has expired', async () => {
    const h = createHarness()
    storeSession(h, -1)

    await expect(createAirAccountBridge(h.options).signMessage(AA_ADDRESS, 'hi')).rejects.toThrow(
      /已过期/
    )
  })

  it('the default (placeholder) KMS throws KmsNotConfiguredError — E-5 pending', async () => {
    const h = createHarness()
    storeSession(h)

    await expect(
      createAirAccountBridge(h.options).signTypedData({ address: AA_ADDRESS, typedData: {} })
    ).rejects.toThrow(KmsNotConfiguredError)
  })
})

describe('AirAccount bridge — configuration', () => {
  it('raises a clear error when VITE_COS72_API is unset', async () => {
    const h = createHarness(`${APP_URL}?code=${CODE}`)

    const bridge = createAirAccountBridge({ ...h.options, apiBase: '' })

    await expect(bridge.connect()).rejects.toThrow(/VITE_COS72_API/)
    expect(h.fetchImpl).not.toHaveBeenCalled()
  })
})
