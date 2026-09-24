import type { TypedDataPayload } from '../../auth/kms'

/**
 * Snapshot X (on-chain) EVM vote backend.
 *
 * SX spaces are contracts; a vote is EIP-712 signed and submitted through the
 * Mana meta-transaction relayer (gasless). This is the SX side of the
 * multi-backend seam introduced for M5 — see docs/snapshot-version-decision.md.
 *
 * `@snapshot-labs/sx` is heavy (ethers v5 + starknet), so it is imported
 * dynamically and only when an SX space is actually voted on. Unit tests inject
 * a fake loader and never load the real SDK.
 */

export type SxEvmNetworkId = 'optimism' | 'base' | 'arbitrum' | 'ethereum' | 'sepolia'

/** Official public Mana relayer — sponsors gasless SX voting. */
export const SX_MANA_URL = 'https://mana.snapshot.box'
/** Official whitelist server sx.js reads strategy whitelists from. */
export const SX_WHITELIST_URL = 'https://wls.snapshot.box'

/** Chain id per network, for display and diagnostics. */
export const SX_EVM_CHAIN_IDS: Record<SxEvmNetworkId, number> = {
  ethereum: 1,
  optimism: 10,
  arbitrum: 42161,
  base: 8453,
  sepolia: 11155111
}

/** Human-readable labels for the supported networks. */
export const SX_NETWORK_LABELS: Record<SxEvmNetworkId, string> = {
  ethereum: 'Ethereum',
  optimism: 'Optimism',
  arbitrum: 'Arbitrum',
  base: 'Base',
  sepolia: 'Sepolia'
}

export function sxNetworkLabel(id: SxEvmNetworkId | null | undefined): string | null {
  return id ? SX_NETWORK_LABELS[id] : null
}

/**
 * Config for the SX EVM client.
 *
 * `provider` must be an ethers-compatible JSON-RPC provider (sx.js reads it to
 * resolve strategy parameters). It is typed `unknown` here so this module does
 * not take a direct `@ethersproject` dependency — the caller supplies one.
 */
export type SxEvmConfig = {
  network: SxEvmNetworkId
  provider: unknown
  manaUrl?: string
  whitelistServerUrl?: string
}

export type ResolvedSxEvmConfig = {
  network: SxEvmNetworkId
  provider: unknown
  manaUrl: string
  whitelistServerUrl: string
}

/**
 * ethers-v5-compatible signer, which is what sx.js reads. Our own signers
 * (wallet / AirAccount KMS) expose a viem-shaped `signTypedData({domain, types,
 * primaryType, message})`, so the adapter re-shapes the call.
 */
export type SxSigner = {
  getAddress(): Promise<string>
  signTypedData(
    domain: unknown,
    types: Record<string, unknown>,
    message: Record<string, unknown>
  ): Promise<string>
  /** ethers v5 spelling; sx.js calls this one. */
  _signTypedData(
    domain: unknown,
    types: Record<string, unknown>,
    message: Record<string, unknown>
  ): Promise<string>
}

/** Mirrors sx.js `StrategyConfig` (params is ABI bytes, usually `0x`). */
export type SxStrategyConfig = {
  index: number
  address: string
  params: string
  metadata?: Record<string, unknown>
}

/** Mirrors sx.js `Vote` (src/clients/evm/types.ts). */
export type SxVoteRequest = {
  space: string
  authenticator: string
  strategies: SxStrategyConfig[]
  proposal: number
  choice: number | number[] | Record<string, number>
  metadataUri: string
}

/** The slice of sx.js `EvmEthereumSig` this module uses. */
export type SxClient = {
  vote(args: { signer: SxSigner; data: SxVoteRequest }): Promise<unknown>
}

export type LoadSxClient = (config: ResolvedSxEvmConfig) => Promise<SxClient>

export interface SxVoteBackend {
  readonly id: 'snapshot-x-evm'
  castVote(request: SxVoteRequest, signer: SxSigner): Promise<unknown>
}

/** Picks the primary struct name out of an EIP-712 types map. */
export function primaryTypeOf(types: Record<string, unknown>): string {
  return Object.keys(types).find((name) => name !== 'EIP712Domain') ?? 'Vote'
}

/**
 * Adapts our viem-shaped typed-data signer to the ethers-v5 interface sx.js
 * calls. `getAddress` and `_signTypedData` are the members sx.js reads.
 */
export function createEthersCompatSigner(
  address: string,
  sign: (payload: TypedDataPayload) => Promise<string>
): SxSigner {
  const signTypedData = (
    domain: unknown,
    types: Record<string, unknown>,
    message: Record<string, unknown>
  ) =>
    sign({
      domain: domain as TypedDataPayload['domain'],
      types: types as TypedDataPayload['types'],
      primaryType: primaryTypeOf(types),
      message
    })

  return {
    getAddress: async () => address,
    signTypedData,
    _signTypedData: signTypedData
  }
}

/** Default loader. The dynamic import keeps the SDK out of the initial bundle. */
const defaultLoadSxClient: LoadSxClient = async (config) => {
  const sx = await import('@snapshot-labs/sx')
  const networkConfig = {
    ethereum: sx.evmMainnet,
    optimism: sx.evmOptimism,
    arbitrum: sx.evmArbitrum,
    base: sx.evmBase,
    sepolia: sx.evmSepolia
  }[config.network]

  // NOTE: the EVM signature client is exported as `EvmEthereumSig`; the bare
  // `EthereumSig` export is the Starknet one and expects a different config.
  const opts = {
    networkConfig,
    manaUrl: config.manaUrl,
    whitelistServerUrl: config.whitelistServerUrl,
    provider: config.provider
  } as unknown as ConstructorParameters<typeof sx.clients.EvmEthereumSig>[0]

  return new sx.clients.EvmEthereumSig(opts) as unknown as SxClient
}

export function createSnapshotXEvmBackend(options: {
  config: SxEvmConfig
  /** Injected in tests; defaults to the code-split dynamic import. */
  loadSxClient?: LoadSxClient
}): SxVoteBackend {
  const config: ResolvedSxEvmConfig = {
    network: options.config.network,
    provider: options.config.provider,
    manaUrl: options.config.manaUrl ?? SX_MANA_URL,
    whitelistServerUrl: options.config.whitelistServerUrl ?? SX_WHITELIST_URL
  }
  const load = options.loadSxClient ?? defaultLoadSxClient
  let client: Promise<SxClient> | null = null

  return {
    id: 'snapshot-x-evm',
    async castVote(request, signer) {
      // Lazily create and memoise: the SDK is fetched at most once.
      client ??= load(config)
      const sxClient = await client
      return sxClient.vote({ signer, data: { ...request } })
    }
  }
}
