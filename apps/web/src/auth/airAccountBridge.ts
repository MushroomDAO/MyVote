import { COS72_API_BASE, COS72_AUTHORIZE_URL } from '../config'
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
 * 1. A user with no session clicks Login. `connect()` stashes a `redirect_uri`
 *    (current origin + path) and navigates to cos72's SSO start page.
 *
 *    Why a *page* and not an API call: `POST /sso/authorize` sits behind cos72's
 *    `JwtAuthGuard` — it mints a code for an *already logged-in cos72 user*, so
 *    only a cos72 first-party page holding that JWT can call it. MyVote has no
 *    cos72 session and cannot call it directly.
 *
 *    !! That landing page does not exist on the cos72 side yet. See
 *    `VITE_COS72_AUTHORIZE_URL` in config.ts — MyVote's half is done and
 *    configurable; cos72 still owes us the page.
 *
 * 2. cos72 redirects back with `?code=<64 hex>` (TTL 60s, single use).
 * 3. `connect()` trades the code at `POST /sso/exchange` for
 *    `{ token, aaAddress, expiresIn }`, persists the session, and strips `code`
 *    from the URL so a refresh cannot replay a spent code.
 * 4. On later loads `restore()` reads the stored session and confirms it with
 *    `GET /sso/verify`.
 *
 * ## Token storage
 *
 * The SSO JWT lives in **sessionStorage**: it survives a refresh (same tab —
 * which is all "don't drop me on reload" requires) but not a browser restart,
 * and it is invisible to other tabs. That keeps the XSS/exfiltration window
 * narrower than localStorage.
 *
 * The stronger design is to hold the token in memory only, backed by an
 * HttpOnly refresh cookie — but cos72 exposes no refresh endpoint today, and the
 * SSO token's TTL is 10 minutes with no renewal, so an in-memory-only token would
 * force a full cos72 round-trip on every page refresh. Revisit once cos72 ships
 * a refresh endpoint.
 */

/** sessionStorage key holding the SSO session. */
export const SESSION_STORAGE_KEY = 'myvote.sso.session'
/** sessionStorage key holding the redirect_uri of the in-flight login. */
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

/**
 * The login code was rejected for good (cos72 answers 401 for invalid / expired /
 * already-consumed / redirect_uri-mismatch alike). Retrying the same code is
 * pointless, so the caller must scrub it and send the user back through cos72.
 */
export class SsoCodeRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsoCodeRejectedError'
  }
}

/** The browser is navigating to cos72 — this "failure" is a redirect in flight. */
export class SsoRedirectingError extends Error {
  constructor(message = '正在跳转到 cos72 登录…') {
    super(message)
    this.name = 'SsoRedirectingError'
  }
}

/** No usable session, and we cannot start a login (e.g. during a silent restore). */
export class SsoNoSessionError extends Error {
  constructor(message = '未检测到 AirAccount 会话,请通过 cos72 登录') {
    super(message)
    this.name = 'SsoNoSessionError'
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type AirAccountBridgeOptions = {
  /** Base URL of the cos72 API, e.g. `https://cos72.example/api/v1`. */
  apiBase?: string
  /** cos72 SSO start page. `redirect_uri` is appended as a query param. */
  authorizeUrl?: string
  /** Remote signer. Defaults to the E-5 placeholder, which throws on every call. */
  kms?: KmsSigner
  fetchImpl?: typeof fetch
  /** Backing store for the session + pending redirect_uri. Defaults to sessionStorage. */
  sessionStorage?: StorageLike
  /** Reads the current URL. Injected for tests. */
  getUrl?: () => string
  /** Replaces the current URL without navigating. Injected for tests. */
  replaceUrl?: (url: string) => void
  /** Navigates away (full page load). Injected for tests. */
  navigate?: (url: string) => void
  /** Clock, injected for tests. */
  now?: () => number
}

export interface AirAccountBridge extends AirAccountAdapter {
  disconnect(): Promise<void>
  /**
   * Interactive login. Consumes a `?code=`, or revalidates a stored session, or
   * — failing both — redirects to cos72 (and rejects with {@link SsoRedirectingError},
   * since the page is going away).
   */
  connect(): Promise<AuthUser>
  /**
   * Silent restore for app start: consumes a `?code=` or revalidates a stored
   * session. Never redirects — an anonymous visitor must not be bounced to cos72
   * just for opening a page.
   */
  restore(): Promise<AuthUser>
  /**
   * Builds the `redirect_uri` for a login round-trip (origin + path, no query or
   * hash), persists it for the subsequent `/sso/exchange`, and returns it.
   */
  prepareLogin(): string
  /** True when a login code is in the URL, or a live session is stored. */
  hasSession(): boolean
  /** The stored session if present and unexpired, else null (purging it if expired). */
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
  const authorizeUrl = options.authorizeUrl ?? COS72_AUTHORIZE_URL
  const kms = options.kms ?? createPlaceholderKmsSigner()
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const now = options.now ?? (() => Date.now())

  const store: StorageLike | undefined =
    options.sessionStorage ?? (typeof window === 'undefined' ? undefined : window.sessionStorage)

  const getUrl = options.getUrl ?? (() => window.location.href)
  const replaceUrl =
    options.replaceUrl ?? ((url: string) => window.history.replaceState(null, '', url))
  const navigate = options.navigate ?? ((url: string) => window.location.assign(url))

  /** Dedupes concurrent connect()/restore() calls — the login code is single-use. */
  let inFlight: Promise<AuthUser> | null = null
  let currentUser: AuthUser | null = null

  function requireApiBase(): string {
    if (!apiBase) throw new Error('cos72 API 未配置:请设置 VITE_COS72_API')
    return apiBase
  }

  function loadSession(): SsoSession | null {
    const raw = store?.getItem(SESSION_STORAGE_KEY)
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
      store?.removeItem(SESSION_STORAGE_KEY)
      return null
    }
  }

  function saveSession(value: SsoSession): void {
    store?.setItem(SESSION_STORAGE_KEY, JSON.stringify(value))
  }

  function clearSession(): void {
    store?.removeItem(SESSION_STORAGE_KEY)
    currentUser = null
  }

  function clearPendingLogin(): void {
    store?.removeItem(REDIRECT_URI_STORAGE_KEY)
  }

  function isExpired(value: SsoSession): boolean {
    return value.expiresAt - EXPIRY_SKEW_MS <= now()
  }

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
    // No query, no hash — cos72 compares redirect_uri byte-for-byte on exchange.
    return `${parsed.origin}${parsed.pathname}`
  }

  function prepareLogin(): string {
    const redirectUri = buildRedirectUri(getUrl())
    store?.setItem(REDIRECT_URI_STORAGE_KEY, redirectUri)
    return redirectUri
  }

  function readCode(url: string): string | null {
    const code = new URL(url).searchParams.get('code')
    if (!code || !CODE_PATTERN.test(code)) return null
    return code
  }

  /** Drops `code` from the URL, keeping every other param and the hash. */
  function stripCodeFromUrl(): void {
    try {
      const parsed = new URL(getUrl())
      if (!parsed.searchParams.has('code')) return
      parsed.searchParams.delete('code')
      const query = parsed.searchParams.toString()
      replaceUrl(`${parsed.origin}${parsed.pathname}${query ? `?${query}` : ''}${parsed.hash}`)
    } catch {
      // Best-effort; the session is already persisted.
    }
  }

  function toUser(value: SsoSession): AuthUser {
    return { address: value.aaAddress, displayName: 'AirAccount' }
  }

  /** Sends the browser to cos72's SSO start page. Never returns normally. */
  function redirectToLogin(): never {
    if (!authorizeUrl) {
      throw new Error('cos72 登录地址未配置:请设置 VITE_COS72_API 或 VITE_COS72_AUTHORIZE_URL')
    }
    const redirectUri = prepareLogin()
    const target = new URL(authorizeUrl)
    target.searchParams.set('redirect_uri', redirectUri)
    navigate(target.toString())
    throw new SsoRedirectingError()
  }

  /** Trades a single-use login code for a session. */
  async function exchangeCode(code: string): Promise<SsoSession> {
    const base = requireApiBase()
    // cos72 requires the exact string it authorized.
    const redirectUri = store?.getItem(REDIRECT_URI_STORAGE_KEY) ?? buildRedirectUri(getUrl())

    let response: Response
    try {
      response = await fetchImpl(`${base}/sso/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code, redirect_uri: redirectUri })
      })
    } catch (e) {
      // Network failure: the code may well still be unspent, so keep it for a retry.
      throw new Error(`SSO 交换请求失败: ${e instanceof Error ? e.message : String(e)}`)
    }

    if (!response.ok) {
      const detail = await readErrorMessage(response, response.statusText)
      if (response.status >= 400 && response.status < 500) {
        // cos72 answers 401 for invalid / expired / spent / redirect-mismatch alike.
        // The code is dead — retrying it can only loop.
        throw new SsoCodeRejectedError(`SSO 交换失败 (${response.status}): ${detail}`)
      }
      // 5xx — cos72 is unwell, not the code. Retryable.
      throw new Error(`SSO 交换失败 (${response.status}): ${detail}`)
    }

    const payload: unknown = await response.json()
    if (!isRecord(payload)) throw new SsoCodeRejectedError('SSO 交换返回了非法响应')

    const { token, aaAddress, expiresIn } = payload
    if (typeof token !== 'string' || !token) throw new SsoCodeRejectedError('SSO 交换响应缺少 token')
    if (typeof aaAddress !== 'string' || !aaAddress) {
      throw new SsoCodeRejectedError('SSO 交换响应缺少 aaAddress')
    }
    if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new SsoCodeRejectedError('SSO 交换响应缺少合法的 expiresIn')
    }

    return { token, aaAddress, expiresAt: now() + expiresIn * 1000 }
  }

  /**
   * Confirms a stored token with cos72.
   *
   * `GET /sso/verify` never throws on a bad token — it answers 200 with
   * `{ valid: false }`. So a non-2xx here means cos72 is unreachable/broken, NOT
   * that our token died: we must not destroy a good session over a blip. Only an
   * explicit `valid: false` (or a 401/403, which the contract says cannot happen
   * but we honour defensively) kills the session.
   */
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

    if (response.status === 401 || response.status === 403) {
      throw new SsoCodeRejectedError('SSO 会话已失效,请重新登录')
    }
    if (!response.ok) {
      // Server-side trouble — keep the session, just don't log in on this attempt.
      throw new Error(
        `SSO 校验失败 (${response.status}): ${await readErrorMessage(response, response.statusText)}`
      )
    }

    const payload: unknown = await response.json()
    if (!isRecord(payload)) {
      throw new Error('SSO 校验返回了非法响应')
    }
    if (payload.valid !== true) {
      throw new SsoCodeRejectedError('SSO 会话已失效,请重新登录')
    }

    const aaAddress =
      typeof payload.aaAddress === 'string' && payload.aaAddress
        ? payload.aaAddress
        : stored.aaAddress

    // Trust the server's address over whatever we cached.
    return { ...stored, aaAddress }
  }

  /**
   * @param interactive when true, a missing session redirects to cos72 instead
   *   of raising {@link SsoNoSessionError}.
   */
  async function resolveSession(interactive: boolean): Promise<AuthUser> {
    const code = readCode(getUrl())

    if (code) {
      let next: SsoSession
      try {
        next = await exchangeCode(code)
      } catch (e) {
        if (e instanceof SsoCodeRejectedError) {
          // Dead code. Scrub it, or the user is stuck in a loop: silent restore
          // swallows the error, hasSession() still sees a `code` in the URL, the
          // wallet entry stays disabled, and every retry burns the same dead code.
          stripCodeFromUrl()
          clearPendingLogin()
        }
        throw e
      }
      saveSession(next)
      clearPendingLogin()
      // Only once the code is safely spent — a transient network failure above
      // leaves it in the URL so the user can retry.
      stripCodeFromUrl()
      currentUser = toUser(next)
      return currentUser
    }

    const stored = getSession()
    if (!stored) {
      if (interactive) redirectToLogin()
      throw new SsoNoSessionError()
    }

    let verified: SsoSession
    try {
      verified = await verifySession(stored)
    } catch (e) {
      // Only a definitive rejection clears the session; a network/5xx blip leaves
      // it in place so the next attempt can still succeed.
      if (e instanceof SsoCodeRejectedError) {
        clearSession()
        if (interactive) redirectToLogin()
      }
      throw e
    }

    saveSession(verified)
    currentUser = toUser(verified)
    return currentUser
  }

  /** Serialises connect()/restore() so a single-use code is never spent twice. */
  function run(interactive: boolean): Promise<AuthUser> {
    if (inFlight) return inFlight
    inFlight = resolveSession(interactive).finally(() => {
      inFlight = null
    })
    return inFlight
  }

  function requireToken(address: string): SsoSession {
    const stored = getSession()
    if (!stored) throw new Error('AirAccount 会话已过期,请重新登录')
    if (address && stored.aaAddress.toLowerCase() !== address.toLowerCase()) {
      throw new Error('签名地址与当前 AirAccount 会话不匹配')
    }
    return stored
  }

  return {
    connect() {
      return run(true)
    },

    restore() {
      return run(false)
    },

    async disconnect() {
      clearSession()
      clearPendingLogin()
    },

    async signMessage(address: string, message: string) {
      const stored = requireToken(address)
      return kms.signMessage({ aaAddress: stored.aaAddress, token: stored.token, message })
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
