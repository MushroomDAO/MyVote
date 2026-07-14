import { computed, ref } from 'vue'

import { SSO_ONLY } from '../config'
import type { AuthProvider, AuthProviderId, AuthUser } from './types'
import { createAirAccountBridge } from './airAccountBridge'
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
   * Silently restores an AirAccount session on app start: consumes a `?code=`
   * handed over by cos72, or revalidates a stored token. This is not
   * user-initiated, so a failure just leaves the app logged out instead of
   * flashing an error banner.
   */
  async function restoreSession(): Promise<void> {
    if (!detectSsoSession()) return
    activeProviderId.value = 'airaccount'
    try {
      user.value = await providersById.airaccount.connect()
    } catch {
      user.value = null
    } finally {
      ssoSessionActive.value = detectSsoSession()
    }
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
    restoreSession
  }
}
