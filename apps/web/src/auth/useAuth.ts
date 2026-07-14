import { computed, ref } from 'vue'

import { SSO_ONLY } from '../config'
import type { AuthProvider, AuthProviderId, AuthUser } from './types'
import {
  createAirAccountBridge,
  SsoCodeRejectedError,
  SsoRedirectingError
} from './airAccountBridge'
import { createAirAccountProvider } from './airAccountProvider'
import { createWalletProvider } from './walletProvider'

/**
 * The live AirAccount bridge (cos72 SSO + KMS signing). Exported so the shell
 * can start a login round-trip through `prepareLogin()`.
 *
 * Signing currently throws `KmsNotConfiguredError` — see `auth/kms.ts` (E-5).
 */
export const airAccountBridge = createAirAccountBridge()

const providersById: Record<AuthProviderId, AuthProvider> = {
  wallet: createWalletProvider(),
  airaccount: createAirAccountProvider(airAccountBridge)
}

/** True when a login code is in the URL, or a live SSO session is stored. */
function detectSsoSession(): boolean {
  try {
    return airAccountBridge.hasSession()
  } catch {
    return false
  }
}

/**
 * AirAccount is the default when this is an SSO-only deployment, or when the
 * user arrived from cos72 / already holds a session. Otherwise: wallet.
 */
function defaultProviderId(): AuthProviderId {
  if (SSO_ONLY) return 'airaccount'
  return detectSsoSession() ? 'airaccount' : 'wallet'
}

const activeProviderId = ref<AuthProviderId>(defaultProviderId())
const user = ref<AuthUser | null>(null)
const error = ref<string | null>(null)
const ssoSessionActive = ref<boolean>(detectSsoSession())

export function useAuth() {
  const provider = computed(() => providersById[activeProviderId.value])
  const isConnected = computed(() => Boolean(user.value))

  /** SSO-only mode, or a live SSO session: the wallet provider is not offered. */
  const walletDisabled = computed(() => SSO_ONLY || ssoSessionActive.value)

  async function setProvider(id: AuthProviderId) {
    if (activeProviderId.value === id) return
    if (id === 'wallet' && walletDisabled.value) {
      error.value = 'AirAccount 登录模式下不可切换到钱包'
      return
    }
    await disconnect()
    activeProviderId.value = id
  }

  async function connect() {
    error.value = null
    try {
      user.value = await provider.value.connect()
    } catch (e) {
      // The AirAccount provider "fails" by navigating to cos72. The page is on
      // its way out — don't flash an error banner on the way.
      if (e instanceof SsoRedirectingError) {
        user.value = null
        return
      }
      error.value = e instanceof Error ? e.message : String(e)
      user.value = null
      throw e
    } finally {
      ssoSessionActive.value = detectSsoSession()
    }
  }

  async function disconnect() {
    error.value = null
    await provider.value.disconnect()
    user.value = null
    ssoSessionActive.value = detectSsoSession()
  }

  /**
   * Restores an AirAccount session on app start: consumes a `?code=` handed over
   * by cos72, or revalidates a stored token.
   *
   * Uses `restore()` rather than `connect()` so an anonymous visitor is never
   * bounced to cos72 just for opening a page — the redirect is reserved for an
   * explicit Login click.
   */
  async function restoreSession(): Promise<void> {
    if (!detectSsoSession()) return
    activeProviderId.value = 'airaccount'
    try {
      user.value = await airAccountBridge.restore()
    } catch (e) {
      user.value = null
      // A dead code (spent/expired/mismatched) is a terminal state the user has
      // to act on. Say so — swallowing it silently while the wallet entry stays
      // disabled is exactly the dead end we're avoiding.
      if (e instanceof SsoCodeRejectedError) {
        error.value = `${e.message}(请重新登录)`
      }
      // Anything else (no session yet, network blip) stays quiet: not user-initiated.
    } finally {
      ssoSessionActive.value = detectSsoSession()
    }
  }

  /**
   * Completes the SSO round-trip on the `/sso/callback` page: exchanges the
   * `?code=` for a session and reports where the user was originally headed.
   *
   * Uses `restore()` (never redirects) — the callback page must show a failure,
   * not bounce back to cos72 in a loop. Throws on failure so the page can render
   * the error and offer "log in again".
   */
  async function completeSsoLogin(): Promise<string> {
    activeProviderId.value = 'airaccount'
    try {
      user.value = await airAccountBridge.restore()
      return airAccountBridge.consumeReturnTo() ?? '/'
    } catch (e) {
      user.value = null
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      ssoSessionActive.value = detectSsoSession()
    }
  }

  /** Sends the user to cos72 to log in. Used by the callback page's retry button. */
  async function startLogin(): Promise<void> {
    activeProviderId.value = 'airaccount'
    await connect()
  }

  return {
    activeProviderId,
    provider,
    user,
    error,
    isConnected,
    ssoOnly: SSO_ONLY,
    walletDisabled,
    setProvider,
    connect,
    disconnect,
    restoreSession,
    completeSsoLogin,
    startLogin
  }
}
