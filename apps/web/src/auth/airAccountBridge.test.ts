import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAirAccountBridge,
  REDIRECT_URI_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  type AirAccountBridgeOptions,
  type SsoSession
} from './airAccountBridge'
import { KmsNotConfiguredError } from './kms'

const API_BASE = 'https://cos72.test/api/v1'
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
  local: ReturnType<typeof createStorage>
  session: ReturnType<typeof createStorage>
  fetchImpl: ReturnType<typeof vi.fn>
  url: { current: string }
  now: { current: number }
  options: AirAccountBridgeOptions
}

function createHarness(initialUrl = APP_URL): Harness {
  const local = createStorage()
  const session = createStorage()
  const fetchImpl = vi.fn()
  const url = { current: initialUrl }
  const now = { current: 1_700_000_000_000 }

  return {
    local,
    session,
    fetchImpl,
    url,
    now,
    options: {
      apiBase: API_BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      localStorage: local,
      sessionStorage: session,
      getUrl: () => url.current,
      replaceUrl: (next: string) => {
        url.current = next
      },
      now: () => now.current
    }
  }
}

function readSession(h: Harness): SsoSession {
  const raw = h.local.getItem(SESSION_STORAGE_KEY)
  if (!raw) throw new Error('no session stored')
  return JSON.parse(raw) as SsoSession
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

    const bridge = createAirAccountBridge(h.options)
    const user = await bridge.connect()

    expect(user.address).toBe(AA_ADDRESS)

    // Called /sso/exchange with the code and the exact stored redirect_uri.
    const [calledUrl, init] = h.fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe(`${API_BASE}/sso/exchange`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      code: CODE,
      redirect_uri: REDIRECT_URI
    })

    // Session persisted with an absolute expiry derived from expiresIn.
    expect(readSession(h)).toEqual({
      token: 'jwt-1',
      aaAddress: AA_ADDRESS,
      expiresAt: h.now.current + 600 * 1000
    })

    // The single-use code is gone from the URL, and the pending redirect_uri is cleared.
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

  it('preserves other query params when stripping the code', async () => {
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
    const [a, b] = await Promise.all([bridge.connect(), bridge.connect()])

    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
    expect(a.address).toBe(AA_ADDRESS)
    expect(b.address).toBe(AA_ADDRESS)
  })

  it('surfaces a rejected exchange and leaves the code in place for a retry', async () => {
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 400))

    const bridge = createAirAccountBridge(h.options)

    await expect(bridge.connect()).rejects.toThrow(/invalid_grant/)
    expect(h.local.getItem(SESSION_STORAGE_KEY)).toBeNull()
    expect(h.url.current).toContain(`code=${CODE}`)
  })

  it('ignores a malformed code and reports "no session" instead of calling the API', async () => {
    h.url.current = `${APP_URL}?code=not-a-valid-code`

    const bridge = createAirAccountBridge(h.options)

    await expect(bridge.connect()).rejects.toThrow(/未检测到 AirAccount 会话/)
    expect(h.fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects an exchange response missing aaAddress', async () => {
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ token: 'jwt-1', expiresIn: 600 }))

    await expect(createAirAccountBridge(h.options).connect()).rejects.toThrow(/aaAddress/)
    expect(h.local.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })
})

describe('AirAccount bridge — session restore via /sso/verify', () => {
  let h: Harness

  beforeEach(() => {
    h = createHarness()
  })

  function storeSession(expiresInMs: number, token = 'jwt-1') {
    h.local.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token, aaAddress: AA_ADDRESS, expiresAt: h.now.current + expiresInMs })
    )
  }

  it('restores a stored session after the server confirms the token', async () => {
    storeSession(600_000)
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ valid: true, aaAddress: AA_ADDRESS }))

    const bridge = createAirAccountBridge(h.options)
    const user = await bridge.connect()

    expect(user.address).toBe(AA_ADDRESS)

    const [calledUrl, init] = h.fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe(`${API_BASE}/sso/verify`)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1')
  })

  it('adopts the server aaAddress over the cached one', async () => {
    storeSession(600_000)
    const serverAddress = '0x2222222222222222222222222222222222222222'
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ valid: true, aaAddress: serverAddress }))

    const user = await createAirAccountBridge(h.options).connect()

    expect(user.address).toBe(serverAddress)
    expect(readSession(h).aaAddress).toBe(serverAddress)
  })

  it('clears the session and refuses to restore when the token is rejected', async () => {
    storeSession(600_000)
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))

    const bridge = createAirAccountBridge(h.options)

    await expect(bridge.connect()).rejects.toThrow(/SSO 校验失败/)
    expect(h.local.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('clears the session when the server answers valid:false', async () => {
    storeSession(600_000)
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ valid: false }))

    await expect(createAirAccountBridge(h.options).connect()).rejects.toThrow(/已失效/)
    expect(h.local.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('reports "no session" without hitting the network when nothing is stored', async () => {
    const bridge = createAirAccountBridge(h.options)

    await expect(bridge.connect()).rejects.toThrow(/未检测到 AirAccount 会话/)
    expect(h.fetchImpl).not.toHaveBeenCalled()
  })

  it('drops a corrupt stored session instead of wedging login', async () => {
    h.local.setItem(SESSION_STORAGE_KEY, '{not json')

    const bridge = createAirAccountBridge(h.options)

    await expect(bridge.connect()).rejects.toThrow(/未检测到 AirAccount 会话/)
    expect(h.local.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })
})

describe('AirAccount bridge — expiry', () => {
  let h: Harness

  beforeEach(() => {
    h = createHarness()
  })

  function storeSession(expiresInMs: number) {
    h.local.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: 'jwt-1', aaAddress: AA_ADDRESS, expiresAt: h.now.current + expiresInMs })
    )
  }

  it('survives a reload while the token is still live', () => {
    storeSession(600_000)

    const bridge = createAirAccountBridge(h.options)

    expect(bridge.hasSession()).toBe(true)
    expect(bridge.getSession()?.token).toBe('jwt-1')
  })

  it('treats an expired session as absent and purges it', async () => {
    storeSession(600_000)
    h.now.current += 601_000 // 10min TTL elapsed

    const bridge = createAirAccountBridge(h.options)

    expect(bridge.getSession()).toBeNull()
    expect(bridge.hasSession()).toBe(false)
    expect(h.local.getItem(SESSION_STORAGE_KEY)).toBeNull()

    await expect(bridge.connect()).rejects.toThrow(/未检测到 AirAccount 会话/)
    expect(h.fetchImpl).not.toHaveBeenCalled()
  })

  it('expires early by the skew window, so a token never dies mid-request', () => {
    storeSession(3_000) // inside the 5s skew

    const bridge = createAirAccountBridge(h.options)

    expect(bridge.getSession()).toBeNull()
  })

  it('reports a session when a code is in the URL, even with nothing stored', () => {
    h.url.current = `${APP_URL}?code=${CODE}`

    expect(createAirAccountBridge(h.options).hasSession()).toBe(true)
  })

  it('disconnect clears the stored session and the pending redirect_uri', async () => {
    storeSession(600_000)
    h.session.setItem(REDIRECT_URI_STORAGE_KEY, REDIRECT_URI)

    const bridge = createAirAccountBridge(h.options)
    await bridge.disconnect()

    expect(h.local.getItem(SESSION_STORAGE_KEY)).toBeNull()
    expect(h.session.getItem(REDIRECT_URI_STORAGE_KEY)).toBeNull()
    expect(bridge.hasSession()).toBe(false)
  })
})

describe('AirAccount bridge — login preparation and signing', () => {
  it('prepareLogin stores a query/hash-free redirect_uri', () => {
    const h = createHarness(`${APP_URL}?foo=1#bar`)

    const bridge = createAirAccountBridge(h.options)
    const redirectUri = bridge.prepareLogin()

    expect(redirectUri).toBe(REDIRECT_URI)
    expect(h.session.getItem(REDIRECT_URI_STORAGE_KEY)).toBe(REDIRECT_URI)
  })

  it('signing delegates to the KMS with the session token and address', async () => {
    const h = createHarness()
    h.local.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: 'jwt-1', aaAddress: AA_ADDRESS, expiresAt: h.now.current + 600_000 })
    )
    const signTypedData = vi.fn().mockResolvedValue('0xdeadbeef')
    const kms = { signTypedData, signMessage: vi.fn() }

    const bridge = createAirAccountBridge({ ...h.options, kms })
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
    h.local.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: 'jwt-1', aaAddress: AA_ADDRESS, expiresAt: h.now.current + 600_000 })
    )

    const bridge = createAirAccountBridge(h.options)

    await expect(
      bridge.signTypedData({
        address: '0x9999999999999999999999999999999999999999',
        typedData: {}
      })
    ).rejects.toThrow(/不匹配/)
  })

  it('refuses to sign once the session has expired', async () => {
    const h = createHarness()
    h.local.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: 'jwt-1', aaAddress: AA_ADDRESS, expiresAt: h.now.current - 1 })
    )

    const bridge = createAirAccountBridge(h.options)

    await expect(bridge.signMessage(AA_ADDRESS, 'hi')).rejects.toThrow(/已过期/)
  })

  it('the default (placeholder) KMS throws KmsNotConfiguredError — E-5 pending', async () => {
    const h = createHarness()
    h.local.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: 'jwt-1', aaAddress: AA_ADDRESS, expiresAt: h.now.current + 600_000 })
    )

    const bridge = createAirAccountBridge(h.options)

    await expect(
      bridge.signTypedData({ address: AA_ADDRESS, typedData: {} })
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
