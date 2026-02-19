import { computed, ref } from 'vue'

import type { AuthProvider, AuthProviderId, AuthUser } from './types'
import { createAirAccountProvider } from './airAccountProvider'
import { createWalletProvider } from './walletProvider'

const providersById: Record<AuthProviderId, AuthProvider> = {
  wallet: createWalletProvider(),
  airaccount: createAirAccountProvider()
}

const activeProviderId = ref<AuthProviderId>('wallet')
const user = ref<AuthUser | null>(null)
const error = ref<string | null>(null)

export function useAuth() {
  const provider = computed(() => providersById[activeProviderId.value])
  const isConnected = computed(() => Boolean(user.value))

  async function setProvider(id: AuthProviderId) {
    if (activeProviderId.value === id) return
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
    }
  }

  async function disconnect() {
    error.value = null
    await provider.value.disconnect()
    user.value = null
  }

  return {
    activeProviderId,
    provider,
    user,
    error,
    isConnected,
    setProvider,
    connect,
    disconnect
  }
}
