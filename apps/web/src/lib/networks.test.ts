import { describe, expect, it, beforeEach } from 'vitest'
import {
  currentNetworkId,
  getCurrentNetwork,
  NETWORK_OPTIONS,
  NETWORK_STORAGE_KEY,
  setNetwork,
  SUPPORTED_NETWORKS
} from './networks'

describe('networks module', () => {
  beforeEach(() => {
    localStorage.clear()
    setNetwork('sepolia')
  })

  it('lists supported networks correctly', () => {
    expect(NETWORK_OPTIONS.length).toBeGreaterThanOrEqual(6)
    expect(SUPPORTED_NETWORKS.sepolia.chainId).toBe(11155111)
    expect(SUPPORTED_NETWORKS.mainnet.chainId).toBe(1)
    expect(SUPPORTED_NETWORKS.optimism.chainId).toBe(10)
  })

  it('switches network and persists to localStorage', () => {
    expect(currentNetworkId.value).toBe('sepolia')
    expect(getCurrentNetwork().name).toBe('Sepolia')

    setNetwork('mainnet')
    expect(currentNetworkId.value).toBe('mainnet')
    expect(getCurrentNetwork().name).toBe('Ethereum')
    expect(localStorage.getItem(NETWORK_STORAGE_KEY)).toBe('mainnet')
  })

  it('ignores invalid network keys', () => {
    setNetwork('sepolia')
    // @ts-expect-error invalid network
    setNetwork('non-existent')
    expect(currentNetworkId.value).toBe('sepolia')
  })

  it('matches networks by chainId, name and alias', async () => {
    const { matchesNetwork } = await import('./networks')
    expect(matchesNetwork('42161', 'arbitrum')).toBe(true)
    expect(matchesNetwork('arb', 'arbitrum')).toBe(true)
    expect(matchesNetwork('8453', 'base')).toBe(true)
    expect(matchesNetwork('1', 'mainnet')).toBe(true)
    expect(matchesNetwork('homestead', 'mainnet')).toBe(true)
    expect(matchesNetwork('11155111', 'sepolia')).toBe(true)
    expect(matchesNetwork('1', 'arbitrum')).toBe(false)
    expect(matchesNetwork('8453', 'all')).toBe(true)
  })

  it('provides correct fallback endpoints', async () => {
    const { getFallbackGraphqlEndpoint, getFallbackSxApiEndpoint } = await import('./networks')
    expect(getFallbackGraphqlEndpoint('https://testnet.hub.snapshot.org/graphql')).toBe('https://hub.snapshot.org/graphql')
    expect(getFallbackGraphqlEndpoint('https://hub.snapshot.org/graphql')).toBe('https://testnet.hub.snapshot.org/graphql')
    expect(getFallbackSxApiEndpoint('https://testnet-api.snapshot.box')).toBe('https://api.snapshot.box')
    expect(getFallbackSxApiEndpoint('https://api.snapshot.box')).toBe('https://testnet-api.snapshot.box')
  })
})
