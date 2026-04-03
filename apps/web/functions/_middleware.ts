/**
 * Cloudflare Pages Middleware
 *
 * Runs at the edge for every request. Responsibilities:
 * 1. /api/graphql proxy → hub.snapshot.org (China connectivity optimization)
 * 2. /api/* routes → pass through to specific function handlers
 * 3. HTML requests → resolve tenant from KV, inject window.__TENANT__
 */

interface Env {
  TENANTS_KV: KVNamespace
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

  // --- API proxy: /api/graphql → Snapshot Hub ---
  if (url.pathname === '/api/graphql') {
    return fetch('https://hub.snapshot.org/graphql', {
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
