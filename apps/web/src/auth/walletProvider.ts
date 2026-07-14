import type { AuthProvider, AuthUser, SignTypedDataParams } from './types'

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>
}

function getEthereum(): Eip1193Provider | null {
  const anyWindow = window as unknown as { ethereum?: Eip1193Provider }
  return anyWindow.ethereum ?? null
}

/** EIP-712 domain fields, in canonical order. */
const DOMAIN_FIELDS = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
  { name: 'salt', type: 'bytes32' }
] as const

/**
 * `eth_signTypedData_v4` requires an explicit `EIP712Domain` entry in `types`,
 * but our payloads follow the ethers/viem convention of omitting it (the KMS and
 * the Snapshot hub both expect it absent). Re-add it here — and only here — from
 * the fields the domain actually carries, so the domain separator is unchanged.
 */
function withDomainType(typedData: unknown): unknown {
  if (typeof typedData !== 'object' || typedData === null) return typedData

  const payload = typedData as { domain?: Record<string, unknown>; types?: Record<string, unknown> }
  if (!payload.domain || !payload.types || payload.types.EIP712Domain) return typedData

  const domain = payload.domain
  return {
    ...payload,
    types: {
      EIP712Domain: DOMAIN_FIELDS.filter((field) => domain[field.name] !== undefined),
      ...payload.types
    }
  }
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
        params: [address, JSON.stringify(withDomainType(typedData))]
      })) as string

      return signature
    }
  }
}
