import { ref } from 'vue'

export type NetworkId = 'sepolia' | 'mainnet' | 'optimism' | 'arbitrum' | 'base' | 'polygon'

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
