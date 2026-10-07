import { ref } from 'vue'

export type NetworkId = 'all' | 'sepolia' | 'mainnet' | 'optimism' | 'arbitrum' | 'base' | 'polygon'

export type NetworkConfig = {
  id: NetworkId
  name: string
  chainId: number
  isTestnet: boolean
  hubUrl: string
  graphqlEndpoint: string
  sxApiEndpoint: string
}

export const SUPPORTED_NETWORKS: Record<NetworkId, NetworkConfig> = {
  all: {
    id: 'all',
    name: 'All (Mainnet)',
    chainId: 0,
    isTestnet: false,
    hubUrl: 'https://hub.snapshot.org',
    graphqlEndpoint: 'https://hub.snapshot.org/graphql',
    sxApiEndpoint: 'https://api.snapshot.box'
  },
  sepolia: {
    id: 'sepolia',
    name: 'Sepolia',
    chainId: 11155111,
    isTestnet: true,
    hubUrl: 'https://testnet.hub.snapshot.org',
    graphqlEndpoint: 'https://testnet.hub.snapshot.org/graphql',
    sxApiEndpoint: 'https://testnet-api.snapshot.box'
  },
  mainnet: {
    id: 'mainnet',
    name: 'Ethereum',
    chainId: 1,
    isTestnet: false,
    hubUrl: 'https://hub.snapshot.org',
    graphqlEndpoint: 'https://hub.snapshot.org/graphql',
    sxApiEndpoint: 'https://api.snapshot.box'
  },
  optimism: {
    id: 'optimism',
    name: 'Optimism',
    chainId: 10,
    isTestnet: false,
    hubUrl: 'https://hub.snapshot.org',
    graphqlEndpoint: 'https://hub.snapshot.org/graphql',
    sxApiEndpoint: 'https://api.snapshot.box'
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum',
    chainId: 42161,
    isTestnet: false,
    hubUrl: 'https://hub.snapshot.org',
    graphqlEndpoint: 'https://hub.snapshot.org/graphql',
    sxApiEndpoint: 'https://api.snapshot.box'
  },
  base: {
    id: 'base',
    name: 'Base',
    chainId: 8453,
    isTestnet: false,
    hubUrl: 'https://hub.snapshot.org',
    graphqlEndpoint: 'https://hub.snapshot.org/graphql',
    sxApiEndpoint: 'https://api.snapshot.box'
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    chainId: 137,
    isTestnet: false,
    hubUrl: 'https://hub.snapshot.org',
    graphqlEndpoint: 'https://hub.snapshot.org/graphql',
    sxApiEndpoint: 'https://api.snapshot.box'
  }
}

export const NETWORK_OPTIONS = Object.values(SUPPORTED_NETWORKS)

export const NETWORK_STORAGE_KEY = 'mv:active-network'

function getInitialNetwork(): NetworkId {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(NETWORK_STORAGE_KEY) as NetworkId | null
    if (saved && SUPPORTED_NETWORKS[saved]) {
      return saved
    }
  }
  return 'sepolia'
}

export const currentNetworkId = ref<NetworkId>(getInitialNetwork())

export function setNetwork(id: NetworkId): void {
  if (!SUPPORTED_NETWORKS[id]) return
  currentNetworkId.value = id
  if (typeof window !== 'undefined') {
    localStorage.setItem(NETWORK_STORAGE_KEY, id)
    window.dispatchEvent(new CustomEvent('mv:network-change', { detail: id }))
  }
}

export function getCurrentNetwork(): NetworkConfig {
  return SUPPORTED_NETWORKS[currentNetworkId.value] ?? SUPPORTED_NETWORKS.sepolia
}

export function matchesNetwork(networkVal: string | undefined | null, targetNetworkId: NetworkId): boolean {
  if (!networkVal) return false
  const trimmed = networkVal.trim().toLowerCase()
  const target = SUPPORTED_NETWORKS[targetNetworkId]
  if (!target) return false

  if (targetNetworkId === 'all') return true
  if (trimmed === String(target.chainId)) return true
  if (trimmed === target.id.toLowerCase()) return true
  if (targetNetworkId === 'mainnet' && (trimmed === '1' || trimmed === 'homestead' || trimmed === 'ethereum')) return true
  if (targetNetworkId === 'sepolia' && (trimmed === '11155111' || trimmed === 'sepolia')) return true
  if (targetNetworkId === 'optimism' && (trimmed === '10' || trimmed === 'oeth')) return true
  if (targetNetworkId === 'arbitrum' && (trimmed === '42161' || trimmed === 'arb' || trimmed === 'arb1')) return true
  if (targetNetworkId === 'base' && trimmed === '8453') return true
  if (targetNetworkId === 'polygon' && (trimmed === '137' || trimmed === 'matic')) return true
  return false
}

export function getFallbackGraphqlEndpoint(currentEndpoint: string): string {
  if (currentEndpoint.includes('testnet.hub.snapshot.org')) {
    return 'https://hub.snapshot.org/graphql'
  }
  return 'https://testnet.hub.snapshot.org/graphql'
}

export function getFallbackSxApiEndpoint(currentEndpoint: string): string {
  if (currentEndpoint.includes('testnet-api.snapshot.box')) {
    return 'https://api.snapshot.box'
  }
  return 'https://testnet-api.snapshot.box'
}

