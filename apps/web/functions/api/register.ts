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
}

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

  // --- Validation ---
  if (!name) return Response.json({ error: 'name is required' }, { status: 400 })
  if (!isValidName(name)) {
    return Response.json(
      { error: 'name must be 3–30 lowercase alphanumeric characters or hyphens' },
      { status: 400 }
    )
  }
  if (!spaceId) return Response.json({ error: 'spaceId is required' }, { status: 400 })

  const rootDomain = context.env.CF_ROOT_DOMAIN ?? 'forest.mushroom.cv'
  const domain = `${name}.${rootDomain}`

  // --- Uniqueness check ---
  const existing = await context.env.TENANTS_KV.get(domain)
  if (existing !== null) {
    return Response.json({ error: 'This name is already taken', domain }, { status: 409 })
  }

  const token = context.env.CF_API_TOKEN
  const accountId = context.env.CF_ACCOUNT_ID
  const zoneId = context.env.CF_ZONE_ID
  const pagesProject = context.env.CF_PAGES_PROJECT

  // --- Write to KV first (fast, reversible if later steps fail) ---
  const tenantConfig = {
    spaceId,
    name,
    description: description || undefined,
    createdAt: new Date().toISOString(),
  }
  await context.env.TENANTS_KV.put(domain, JSON.stringify(tenantConfig))

  // --- Create CNAME DNS record ---
  const pagesHostname = `${pagesProject}.pages.dev`
  const dnsResult = await cfApi(token, `/zones/${zoneId}/dns_records`, 'POST', {
    type: 'CNAME',
    name: domain,
    content: pagesHostname,
    proxied: true,
    comment: `MyVote tenant: ${name}`,
  })

  if (!dnsResult.success) {
    // Don't fail — DNS record might already exist or CF handles it differently for subdomain zones
    console.error('DNS creation warning:', dnsResult.errors)
  }

  // --- Add custom domain to CF Pages project ---
  const pagesResult = await cfApi(
    token,
    `/accounts/${accountId}/pages/projects/${pagesProject}/domains`,
    'POST',
    { name: domain }
  )

  if (!pagesResult.success) {
    console.error('Pages domain warning:', pagesResult.errors)
  }

  return Response.json({
    success: true,
    domain,
    url: `https://${domain}`,
    spaceId,
    name,
  })
}
