/**
 * Cloudflare Pages Middleware
 *
 * Runs at the edge for every request. Responsibilities:
 * 1. Tenant resolution: reads hostname → looks up tenants.json → injects window.__TENANT__ into HTML
 * 2. API proxy: /api/graphql → hub.snapshot.org/graphql (helps with China connectivity)
 */

import TENANTS_RAW from '../tenants.json'

type TenantConfig = {
  spaceId?: string
  name?: string
  logo?: string | null
  description?: string
  colors?: Record<string, string>
}

// tenants.json keys starting with '_comment' are documentation — strip them.
const TENANTS = Object.fromEntries(
  Object.entries(TENANTS_RAW as Record<string, unknown>).filter(([k]) => !k.startsWith('_comment'))
) as Record<string, TenantConfig>

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url)

  // --- API proxy: /api/graphql → Snapshot Hub ---
  if (url.pathname === '/api/graphql') {
    return fetch('https://hub.snapshot.org/graphql', {
      method: context.request.method,
      headers: { 'content-type': 'application/json' },
      body: context.request.body,
    })
  }

  // --- Tenant resolution + HTML injection ---
  const hostname = url.hostname
  const tenantConfig: TenantConfig | undefined = TENANTS[hostname]

  const response = await context.next()

  // Only inject into HTML responses
  const contentType = response.headers.get('content-type') ?? ''
  if (!tenantConfig || !contentType.includes('text/html')) {
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
