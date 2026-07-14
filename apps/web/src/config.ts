function getEnv(name: string): string | undefined {
  const value = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name]
  // A bare `VITE_X=` line yields ''. Treat it as unset so defaults still apply.
  return value === '' ? undefined : value
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Snapshot Hub.
 *
 * MV-0 finding: a space whose network is Sepolia only exists on the *testnet*
 * hub — the mainnet hub rejects its proposals/votes. MyVote targets a Sepolia
 * space, so the hub and the GraphQL endpoint both default to testnet.
 */
export const SNAPSHOT_HUB_URL = stripTrailingSlash(
  getEnv('VITE_SNAPSHOT_HUB') ??
    // Back-compat with the pre-MV-3 variable name.
    getEnv('VITE_SNAPSHOT_HUB_URL') ??
    'https://testnet.hub.snapshot.org'
)

export const GRAPHQL_ENDPOINT =
  getEnv('VITE_SNAPSHOT_GRAPHQL_ENDPOINT') ?? `${SNAPSHOT_HUB_URL}/graphql`

export const SNAPSHOT_APP_NAME = getEnv('VITE_SNAPSHOT_APP_NAME') ?? 'myvote'

/**
 * cos72 backend origin (scheme + host, no path). The SSO endpoints live under
 * `${VITE_COS72_API}/api/v1`. Empty when unset — the AirAccount bridge then
 * raises a configuration error instead of calling a wrong origin.
 */
export const COS72_API_ORIGIN = stripTrailingSlash(getEnv('VITE_COS72_API') ?? '')

/** Base URL for the cos72 SSO endpoints. Empty string when unconfigured. */
export const COS72_API_BASE = COS72_API_ORIGIN ? `${COS72_API_ORIGIN}/api/v1` : ''

/**
 * When true this is an AirAccount-only deployment: the wallet provider is
 * hidden from the UI and AirAccount is the default provider.
 */
export const SSO_ONLY = getEnv('VITE_SSO_ONLY') === 'true'
