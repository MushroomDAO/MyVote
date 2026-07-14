import { COS72_API_BASE } from '../config'
import type { AirAccountAdapter } from './airAccountProvider'
import {
  createPlaceholderKmsSigner,
  type KmsSigner,
  type TypedDataPayload
} from './kms'
import type { AuthUser, SignTypedDataParams } from './types'

/**
 * AirAccount bridge — cos72 SSO session + KMS-backed signing.
 *
 * ## Login flow
 *
 * 1. MyVote sends the user to cos72's authorize page with a `redirect_uri`
 *    pointing back here. {@link AirAccountBridge.prepareLogin} builds that URI
 *    and stashes it in sessionStorage, because `/sso/exchange` requires the
 *    *exact same* string back — a mismatch (even a trailing slash) is rejected.
 * 2. cos72 redirects back with `?code=<64 hex>`.
 * 3. `connect()` trades the code for `{ token, aaAddress, expiresIn }` at
 *    `POST /sso/exchange`, persists the session to localStorage, and strips
 *    `code` from the URL so a refresh cannot replay a spent (single-use) code.
 * 4. On later loads `connect()` finds no code, reads the stored session, and
 *    confirms it with `GET /sso/verify` before restoring it.
 *
 * The SSO JWT is short-lived (10 min per the cos72 contract) and there is no
 * refresh endpoint. Once it expires the session is cleared and the user must
 * log in through cos72 again.
 */

/** localStorage key holding the persisted SSO session. */
export const SESSION_STORAGE_KEY = 'myvote.sso.session'
/** sessionStorage key holding the redirect_uri used for the in-flight login. */
export const REDIRECT_URI_STORAGE_KEY = 'myvote.sso.redirect_uri'

/**
 * Treat a token as expired this many ms early, so we never start a request with
 * a token that dies in flight.
 */
const EXPIRY_SKEW_MS = 5_000

/** cos72 hands back a 32-byte code, hex-encoded. */
const CODE_PATTERN = /^[0-9a-fA-F]{64}$/

export type SsoSession = {
  /** SSO JWT (audience `myvote`). */
  token: string
  /** AirAccount smart-account address. */
  aaAddress: string
  /** Absolute expiry, ms since epoch. */
  expiresAt: number
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type AirAccountBridgeOptions = {
  /** Base URL of the cos72 API, e.g. `https://cos72.example/api/v1`. */
  apiBase?: string
  /** Remote signer. Defaults to the E-5 placeholder, which throws on every call. */
  kms?: KmsSigner
  fetchImpl?: typeof fetch
  localStorage?: StorageLike
  sessionStorage?: StorageLike
  /** Reads the current URL. Injected for tests. */
  getUrl?: () => string
  /** Replaces the current URL without navigating. Injected for tests. */
  replaceUrl?: (url: string) => void
  /** Clock, injected for tests. */
  now?: () => number
}

export interface AirAccountBridge extends AirAccountAdapter {
  disconnect(): Promise<void>
  /**
   * Builds the `redirect_uri` for a login round-trip (current origin + path, no
   * query/hash), persists it for the subsequent `/sso/exchange`, and returns it.
   * Call this immediately before navigating to cos72's authorize page.
   */
  prepareLogin(): string
  /** True when a login code is present in the URL, or a non-expired session is stored. */
  hasSession(): boolean
  /** The stored session if present and unexpired, else null (clearing it if expired). */
  getSession(): SsoSession | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Pulls a human-readable error out of a non-2xx response body. */
async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const text = await response.text()
    if (!text) return fallback
    try {
      const parsed: unknown = JSON.parse(text)
      if (isRecord(parsed)) {
        const detail = parsed.error ?? parsed.message
        if (typeof detail === 'string' && detail) return detail
      }
    } catch {
      // Not JSON — fall through to the raw text.
    }
    return text.slice(0, 200)
  } catch {
    return fallback
  }
}

export function createAirAccountBridge(options: AirAccountBridgeOptions = {}): AirAccountBridge {
  const apiBase = (options.apiBase ?? COS72_API_BASE).replace(/\/+$/, '')
  const kms = options.kms ?? createPlaceholderKmsSigner()
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const now = options.now ?? (() => Date.now())

  const local: StorageLike | undefined =
    options.localStorage ?? (typeof window === 'undefined' ? undefined : window.localStorage)
  const session: StorageLike | undefined =
    options.sessionStorage ?? (typeof window === 'undefined' ? undefined : window.sessionStorage)

  const getUrl = options.getUrl ?? (() => window.location.href)
  const replaceUrl =
    options.replaceUrl ?? ((url: string) => window.history.replaceState(null, '', url))

  /** Dedupes concurrent connect() calls — the login code is single-use. */
  let inFlightConnect: Promise<AuthUser> | null = null
  let currentUser: AuthUser | null = null

  function requireApiBase(): string {
    if (!apiBase) {
      throw new Error('cos72 API 未配置：请设置 VITE_COS72_API')
    }
    return apiBase
  }

  function loadSession(): SsoSession | null {
    const raw = local?.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isRecord(parsed)) return null
      const { token, aaAddress, expiresAt } = parsed
      if (typeof token !== 'string' || !token) return null
      if (typeof aaAddress !== 'string' || !aaAddress) return null
      if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null
      return { token, aaAddress, expiresAt }
    } catch {
      // Corrupt entry — drop it rather than wedging login forever.
      local?.removeItem(SESSION_STORAGE_KEY)
      return null
    }
  }

  function saveSession(value: SsoSession): void {
    local?.setItem(SESSION_STORAGE_KEY, JSON.stringify(value))
  }

  function clearSession(): void {
    local?.removeItem(SESSION_STORAGE_KEY)
    currentUser = null
  }

  function isExpired(value: SsoSession): boolean {
    return value.expiresAt - EXPIRY_SKEW_MS <= now()
  }

  /** Stored session if usable; clears and returns null when expired. */
  function getSession(): SsoSession | null {
    const stored = loadSession()
    if (!stored) return null
    if (isExpired(stored)) {
      clearSession()
      return null
    }
    return stored
  }

  function buildRedirectUri(url: string): string {
    const parsed = new URL(url)
    // No query, no hash — cos72 compares redirect_uri byte-for-byte.
    return `${parsed.origin}${parsed.pathname}`
  }

  function prepareLogin(): string {
    const redirectUri = buildRedirectUri(getUrl())
    session?.setItem(REDIRECT_URI_STORAGE_KEY, redirectUri)
    return redirectUri
  }

  function readCode(url: string): string | null {
    const code = new URL(url).searchParams.get('code')
    if (!code) return null
    if (!CODE_PATTERN.test(code)) return null
    return code
  }

  function stripCodeFromUrl(): void {
    try {
      const parsed = new URL(getUrl())
      if (!parsed.searchParams.has('code')) return
      parsed.searchParams.delete('code')
      const query = parsed.searchParams.toString()
      replaceUrl(`${parsed.origin}${parsed.pathname}${query ? `?${query}` : ''}${parsed.hash}`)
    } catch {
      // Cleaning the URL is best-effort; the session is already persisted.
    }
  }

  function toUser(value: SsoSession): AuthUser {
    return {
      address: value.aaAddress,
      displayName: 'AirAccount'
    }
  }

  /** Trades a single-use login code for a session. */
  async function exchangeCode(code: string): Promise<SsoSession> {
    const base = requireApiBase()
    // The URI we were redirected to; cos72 requires the exact string it authorized.
    const redirectUri = session?.getItem(REDIRECT_URI_STORAGE_KEY) ?? buildRedirectUri(getUrl())

    let response: Response
    try {
      response = await fetchImpl(`${base}/sso/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code, redirect_uri: redirectUri })
      })
    } catch (e) {
      throw new Error(`SSO 交换请求失败: ${e instanceof Error ? e.message : String(e)}`)
    }

    if (!response.ok) {
      throw new Error(
        `SSO 交换失败 (${response.status}): ${await readErrorMessage(response, response.statusText)}`
      )
    }

    const payload: unknown = await response.json()
    if (!isRecord(payload)) throw new Error('SSO 交换返回了非法响应')

    const { token, aaAddress, expiresIn } = payload
    if (typeof token !== 'string' || !token) throw new Error('SSO 交换响应缺少 token')
    if (typeof aaAddress !== 'string' || !aaAddress) throw new Error('SSO 交换响应缺少 aaAddress')
    if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error('SSO 交换响应缺少合法的 expiresIn')
    }

    return { token, aaAddress, expiresAt: now() + expiresIn * 1000 }
  }

  /** Confirms a stored token with the server; returns the authoritative aaAddress. */
  async function verifySession(stored: SsoSession): Promise<SsoSession> {
    const base = requireApiBase()

    let response: Response
    try {
      response = await fetchImpl(`${base}/sso/verify`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${stored.token}`, Accept: 'application/json' }
      })
    } catch (e) {
      throw new Error(`SSO 校验请求失败: ${e instanceof Error ? e.message : String(e)}`)
    }

    if (!response.ok) {
      // 401/403 => the token is dead; anything else is a server problem. Either
      // way we cannot trust the session, so drop it.
      throw new Error(
        `SSO 校验失败 (${response.status}): ${await readErrorMessage(response, response.statusText)}`
      )
    }

    const payload: unknown = await response.json()
    if (!isRecord(payload) || payload.valid !== true) {
      throw new Error('SSO 会话已失效，请重新登录')
    }

    const aaAddress =
      typeof payload.aaAddress === 'string' && payload.aaAddress
        ? payload.aaAddress
        : stored.aaAddress

    // Trust the server's address over whatever we cached.
    return { ...stored, aaAddress }
  }

  async function doConnect(): Promise<AuthUser> {
    const code = readCode(getUrl())

    if (code) {
      const next = await exchangeCode(code)
      saveSession(next)
      session?.removeItem(REDIRECT_URI_STORAGE_KEY)
      // Only after the code is safely spent — a transient network failure above
      // leaves it in the URL so the user can retry.
      stripCodeFromUrl()
      currentUser = toUser(next)
      return currentUser
    }

    const stored = getSession()
    if (!stored) {
      throw new Error('未检测到 AirAccount 会话，请通过 cos72 登录')
    }

    let verified: SsoSession
    try {
      verified = await verifySession(stored)
    } catch (e) {
      clearSession()
      throw e
    }

    saveSession(verified)
    currentUser = toUser(verified)
    return currentUser
  }

  /** The session token, or a thrown error telling the user to log in again. */
  function requireToken(address: string): SsoSession {
    const stored = getSession()
    if (!stored) throw new Error('AirAccount 会话已过期，请重新登录')
    if (address && stored.aaAddress.toLowerCase() !== address.toLowerCase()) {
      throw new Error('签名地址与当前 AirAccount 会话不匹配')
    }
    return stored
  }

  return {
    async connect() {
      // Concurrent callers (auto-restore on mount + a user click) must not both
      // burn the single-use code.
      if (inFlightConnect) return inFlightConnect
      inFlightConnect = doConnect().finally(() => {
        inFlightConnect = null
      })
      return inFlightConnect
    },

    async disconnect() {
      clearSession()
      session?.removeItem(REDIRECT_URI_STORAGE_KEY)
    },

    async signMessage(address: string, message: string) {
      const stored = requireToken(address)
      return kms.signMessage({
        aaAddress: stored.aaAddress,
        token: stored.token,
        message
      })
    },

    async signTypedData({ address, typedData }: SignTypedDataParams) {
      const stored = requireToken(address)
      return kms.signTypedData({
        aaAddress: stored.aaAddress,
        token: stored.token,
        typedData: typedData as TypedDataPayload
      })
    },

    prepareLogin,

    hasSession() {
      if (readCode(getUrl())) return true
      return getSession() !== null
    },

    getSession
  }
}
