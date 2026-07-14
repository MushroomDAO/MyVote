/**
 * Cloudflare Pages Middleware
 *
 * Runs at the edge for every request. Responsibilities:
 * 1. /api/graphql proxy → Snapshot Hub, per SNAPSHOT_HUB (China connectivity optimization)
 * 2. /api/* routes → pass through to specific function handlers
 * 3. HTML requests → resolve tenant from KV, inject window.__TENANT__
 */

interface Env {
  TENANTS_KV: KVNamespace
  /**
   * Snapshot Hub the /api/graphql proxy forwards to. MUST match the frontend's
   * VITE_SNAPSHOT_HUB: a testnet (e.g. Sepolia) space exists only on the testnet
   * hub, so a mainnet proxy would silently read back empty data for it.
   */
  SNAPSHOT_HUB?: string
}

/** Keep in sync with `src/config.ts` (VITE_SNAPSHOT_HUB). */
const DEFAULT_SNAPSHOT_HUB = 'https://testnet.hub.snapshot.org'

/** Only ever proxy to a known Snapshot hub — never to an arbitrary env-supplied host. */
const ALLOWED_HUBS = new Set([
  'https://testnet.hub.snapshot.org',
  'https://hub.snapshot.org',
])

function resolveGraphqlEndpoint(env: Env): string {
  const hub = (env.SNAPSHOT_HUB ?? DEFAULT_SNAPSHOT_HUB).replace(/\/+$/, '')
  if (!ALLOWED_HUBS.has(hub)) {
    throw new Error(`SNAPSHOT_HUB is not an allowed Snapshot hub: ${hub}`)
  }
  return `${hub}/graphql`
}

type TenantConfig = {
  spaceId?: string
  name?: string
  logo?: string | null
  description?: string
  colors?: Record<string, string>
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)

  // --- API proxy: /api/graphql → Snapshot Hub (testnet by default) ---
  if (url.pathname === '/api/graphql') {
    let endpoint: string
    try {
      endpoint = resolveGraphqlEndpoint(context.env)
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      )
    }

    return fetch(endpoint, {
      method: context.request.method,
      headers: { 'content-type': 'application/json' },
      body: context.request.body,
    })
  }

  // --- Other /api/* routes → pass to their specific function handlers ---
  if (url.pathname.startsWith('/api/')) {
    return context.next()
  }

  // --- Tenant resolution + HTML injection ---
  const response = await context.next()

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html')) {
    return response
  }

  // Look up tenant config from KV (gracefully handle missing KV binding in local dev)
  let tenantConfig: TenantConfig | null = null
  try {
    tenantConfig = await context.env.TENANTS_KV.get<TenantConfig>(url.hostname, 'json')
  } catch {
    // KV not available (e.g., local dev without wrangler) — skip injection
  }

  if (!tenantConfig) {
    return response
  }

  let html = await response.text()
  const script = `<script>window.__TENANT__=${JSON.stringify(tenantConfig)}<\/script>`
  html = html.replace('</head>', `${script}</head>`)

  return new Response(html, {
    status: response.status,
    headers: response.headers,
  })
}
