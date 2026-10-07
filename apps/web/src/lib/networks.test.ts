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
})
