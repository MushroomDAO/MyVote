import type { AuthProvider, AuthUser, SignTypedDataParams } from './types'

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>
}

function getEthereum(): Eip1193Provider | null {
  const anyWindow = window as unknown as { ethereum?: Eip1193Provider }
  return anyWindow.ethereum ?? null
}

export function createWalletProvider(): AuthProvider {
  let user: AuthUser | null = null

  return {
    id: 'wallet',
    name: 'Wallet',
    async connect() {
      const ethereum = getEthereum()
      if (!ethereum) throw new Error('No injected wallet found')

      const accounts = (await ethereum.request({
        method: 'eth_requestAccounts'
      })) as string[]

      const address = accounts?.[0]
      if (!address) throw new Error('No account selected')

      user = { address }
      return user
    },
    async disconnect() {
      user = null
    },
    getUser() {
      return user
    },
    async signMessage(address: string, message: string) {
      const ethereum = getEthereum()
      if (!ethereum) throw new Error('No injected wallet found')

      const signature = (await ethereum.request({
        method: 'personal_sign',
        params: [message, address]
      })) as string

      return signature
    },
    async signTypedData({ address, typedData }: SignTypedDataParams) {
      const ethereum = getEthereum()
      if (!ethereum) throw new Error('No injected wallet found')

      const signature = (await ethereum.request({
        method: 'eth_signTypedData_v4',
        params: [address, JSON.stringify(typedData)]
      })) as string

      return signature
    }
  }
}
