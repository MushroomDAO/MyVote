import {
  createSnapshotXEvmBackend,
  type LoadSxClient,
  type SxEvmNetworkId,
  type SxVoteBackend
} from './backend'

/**
 * Minimal ethers-v5 `Provider` adapter over an EIP-1193 provider.
 *
 * sx.js types its client config as an ethers Provider. Its signature (Mana) vote
 * path only reads `networkConfig`, but the strategy layer is allowed to make
 * chain reads, so we expose the handful of read methods an ethers provider has
 * and forward them to the injected EIP-1193 provider — avoiding a direct
 * `@ethersproject/providers` dependency in the app.
 */

/** The slice of EIP-1193 (e.g. `window.ethereum`) we forward to. */
export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>
}

export type Hex = string

export type EthersCompatProvider = {
  /** The raw EIP-1193 provider, as ethers exposes it. */
  provider: Eip1193Provider
  call(tx: {
    to?: string
    data?: string
    from?: string
    value?: unknown
    gas?: unknown
  }): Promise<Hex>
  getNetwork(): Promise<{ chainId: number; name: string }>
  getBlockNumber(): Promise<number>
  getCode(address: string): Promise<Hex>
  getStorageAt(address: string, position: number | string): Promise<Hex>
  getTransactionCount(address: string): Promise<number>
  getBalance(address: string): Promise<Hex>
  getLogs(filter: {
    address?: string | string[]
    topics?: unknown[]
    fromBlock?: string | number
    toBlock?: string | number
  }): Promise<unknown[]>
}

/** Converts a number/decimal string/bigint to a 0x-quantity; passes through hex. */
export function toHexQuantity(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'bigint') return `0x${value.toString(16)}`
  if (typeof value === 'number') return `0x${value.toString(16)}`
  if (typeof value === 'string') {
    return value.startsWith('0x') ? value : `0x${BigInt(value).toString(16)}`
  }
  return undefined
}

function hexToNumber(value: unknown): number {
  if (typeof value !== 'string') return 0
  return Number.parseInt(value, 16)
}

function blockTag(value: string | number): string {
  return typeof value === 'number' ? toHexQuantity(value)! : value
}

export function wrapEip1193(provider: Eip1193Provider): EthersCompatProvider {
  return {
    provider,

    async call(tx) {
      const params: Record<string, unknown> = {}
      if (tx.to) params.to = tx.to
      if (tx.data) params.data = tx.data
      if (tx.from) params.from = tx.from
      const value = toHexQuantity(tx.value)
      if (value) params.value = value
      const gas = toHexQuantity(tx.gas)
      if (gas) params.gas = gas

      return (await provider.request({ method: 'eth_call', params: [params, 'latest'] })) as Hex
    },

    async getNetwork() {
      return { chainId: hexToNumber(await provider.request({ method: 'eth_chainId' })), name: '' }
    },

    async getBlockNumber() {
      return hexToNumber(await provider.request({ method: 'eth_blockNumber' }))
    },

    async getCode(address) {
      return (await provider.request({
        method: 'eth_getCode',
        params: [address, 'latest']
      })) as Hex
    },

    async getStorageAt(address, position) {
      const slot = typeof position === 'number' ? toHexQuantity(position)! : position
      return (await provider.request({
        method: 'eth_getStorageAt',
        params: [address, slot, 'latest']
      })) as Hex
    },

    async getTransactionCount(address) {
      return hexToNumber(
        await provider.request({ method: 'eth_getTransactionCount', params: [address, 'latest'] })
      )
    },

    async getBalance(address) {
      return (await provider.request({
        method: 'eth_getBalance',
        params: [address, 'latest']
      })) as Hex
    },

    async getLogs(filter) {
      const params: Record<string, unknown> = {}
      if (filter.address) params.address = filter.address
      if (filter.topics) params.topics = filter.topics
      if (filter.fromBlock !== undefined) params.fromBlock = blockTag(filter.fromBlock)
      if (filter.toBlock !== undefined) params.toBlock = blockTag(filter.toBlock)

      return (await provider.request({ method: 'eth_getLogs', params: [params] })) as unknown[]
    }
  }
}

/** Builds an SX EVM backend whose provider is the caller's EIP-1193 wallet. */
export function createSxBackendFromEip1193(options: {
  network: SxEvmNetworkId
  eip1193: Eip1193Provider
  manaUrl?: string
  whitelistServerUrl?: string
  /** Injected in tests; defaults to the code-split sx.js dynamic import. */
  loadSxClient?: LoadSxClient
}): SxVoteBackend {
  return createSnapshotXEvmBackend({
    config: {
      network: options.network,
      provider: wrapEip1193(options.eip1193),
      manaUrl: options.manaUrl,
      whitelistServerUrl: options.whitelistServerUrl
    },
    loadSxClient: options.loadSxClient
  })
}
