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
 * The single, fixed path cos72 is allowed to redirect back to.
 *
 * Standard OAuth practice: one exact callback path, never the page the user
 * happened to be on. cos72 whitelists `https://<myvote-host>/sso/callback` and
 * nothing else — registering a bare origin would let *any* open-redirect or XSS
 * sink anywhere on the MyVote domain receive a live SSO code.
 *
 * Where the user actually wanted to go is carried in local `state`
 * (sessionStorage `returnTo`), not in the redirect_uri.
 */
export const SSO_CALLBACK_PATH = getEnv('VITE_SSO_CALLBACK_PATH') ?? '/sso/callback'

/**
 * cos72's SSO start page — where MyVote sends a user who has no session. MyVote
 * appends `?redirect_uri=<origin + SSO_CALLBACK_PATH>`; the page is expected to ensure the user
 * is logged in to cos72, call `POST /api/v1/sso/authorize` with that
 * `redirect_uri` (it needs the cos72 JWT, which only a cos72 first-party page
 * holds), and redirect back with `?code=<64 hex>`.
 *
 * !! PENDING ON THE cos72 SIDE: this landing page does not exist yet. The API
 * (`/sso/authorize`) is guarded by `JwtAuthGuard`, so MyVote cannot mint a code
 * itself. Until cos72 ships the page, point this at whatever route they land on.
 */
export const COS72_AUTHORIZE_URL =
  getEnv('VITE_COS72_AUTHORIZE_URL') ??
  (COS72_API_ORIGIN ? `${COS72_API_ORIGIN}/sso/start` : '')

/**
 * When true this is an AirAccount-only deployment: the wallet provider is
 * hidden from the UI and AirAccount is the default provider.
 */
export const SSO_ONLY = getEnv('VITE_SSO_ONLY') === 'true'
