/**
 * POST /api/register
 * Register a new community subdomain.
 *
 * Body: { name: string, spaceId: string, description?: string }
 *
 * Steps:
 * 1. Validate inputs
 * 2. Check KV uniqueness
 * 3. Write tenant config to KV
 * 4. Create CNAME DNS record via CF API
 * 5. Add custom domain to CF Pages project via CF API
 */

interface Env {
  TENANTS_KV: KVNamespace
  CF_ACCOUNT_ID: string
  CF_API_TOKEN: string
  CF_ZONE_ID: string
  CF_PAGES_PROJECT: string
  CF_ROOT_DOMAIN: string
}

type RegisterBody = {
  name: string
  spaceId: string
  description?: string
  /** Registrant contact email (M4-B interim identity). Stored as contact only. */
  email?: string
}

// Shared with the app (single tested source) — functions are bundled by esbuild,
// so a relative import into src is fine as long as the module stays browser-free.
import { isValidEmail } from '../../src/lib/email'

function isValidName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(name)
}

async function cfApi(token: string, path: string, method: string, body?: unknown) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return res.json() as Promise<{ success: boolean; errors?: { message: string }[]; result?: unknown }>
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: RegisterBody
  try {
    body = await context.request.json() as RegisterBody
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = body.name?.toLowerCase().trim() ?? ''
  const spaceId = body.spaceId?.trim() ?? ''
  const description = body.description?.trim() ?? ''
  const email = body.email?.trim().toLowerCase() ?? ''

  // --- Validation ---
  if (!name) return Response.json({ error: 'name is required' }, { status: 400 })
  if (!isValidName(name)) {
    return Response.json(
      { error: 'name must be 3–30 lowercase alphanumeric characters or hyphens' },
      { status: 400 }
    )
  }
  if (!spaceId) return Response.json({ error: 'spaceId is required' }, { status: 400 })
  if (!email) return Response.json({ error: 'email is required' }, { status: 400 })
  if (!isValidEmail(email)) {
    return Response.json({ error: 'email is invalid' }, { status: 400 })
  }

  const rootDomain = context.env.CF_ROOT_DOMAIN ?? 'forest.mushroom.cv'
  const domain = `${name}.${rootDomain}`

  // --- Uniqueness check ---
  const existing = await context.env.TENANTS_KV.get(domain)
  if (existing !== null) {
    return Response.json({ error: 'This name is already taken', domain }, { status: 409 })
  }

  const token = context.env.CF_API_TOKEN
  const accountId = context.env.CF_ACCOUNT_ID
  const pagesProject = context.env.CF_PAGES_PROJECT

  // --- Write to KV ---
  const tenantConfig = {
    spaceId,
    name,
    description: description || undefined,
    // Contact only. _middleware allowlists which fields reach window.__TENANT__,
    // so this never becomes public page source.
    contactEmail: email,
    createdAt: new Date().toISOString(),
  }
  await context.env.TENANTS_KV.put(domain, JSON.stringify(tenantConfig))

  // --- Add custom domain to CF Pages project (triggers SSL cert issuance) ---
  // Wildcard DNS *.forest.mushroom.cv is already configured; we only need the Pages domain
  // registration to enable HTTPS for this specific subdomain.
  if (token && accountId && pagesProject) {
    const pagesResult = await cfApi(
      token,
      `/accounts/${accountId}/pages/projects/${pagesProject}/domains`,
      'POST',
      { name: domain }
    )
    if (!pagesResult.success) {
      // Log but don't fail — KV is written; admin can manually add the domain if needed
      console.error('Pages domain registration failed:', JSON.stringify(pagesResult.errors))
    }
  } else {
    console.warn('CF_API_TOKEN / CF_ACCOUNT_ID / CF_PAGES_PROJECT not set — skipping Pages domain registration')
  }

  return Response.json({
    success: true,
    domain,
    url: `https://${domain}`,
    spaceId,
    name,
  })
}
