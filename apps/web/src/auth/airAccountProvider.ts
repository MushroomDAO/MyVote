import type { AuthProvider, AuthUser, SignTypedDataParams } from './types'

export type AirAccountAdapter = {
  connect(): Promise<AuthUser>
  disconnect?(): Promise<void>
  signMessage(address: string, message: string): Promise<string>
  signTypedData(params: SignTypedDataParams): Promise<string>
}

export function createAirAccountProvider(adapter?: AirAccountAdapter): AuthProvider {
  let user: AuthUser | null = null

  return {
    id: 'airaccount',
    name: 'AirAccount',
    async connect() {
      if (!adapter) throw new Error('AirAccount adapter not configured')
      user = await adapter.connect()
      return user
    },
    async disconnect() {
      if (adapter?.disconnect) await adapter.disconnect()
      user = null
    },
    getUser() {
      return user
    },
    async signMessage(address: string, message: string) {
      if (!adapter) throw new Error('AirAccount adapter not configured')
      return adapter.signMessage(address, message)
    },
    async signTypedData(params: SignTypedDataParams) {
      if (!adapter) throw new Error('AirAccount adapter not configured')
      return adapter.signTypedData(params)
    }
  }
}
