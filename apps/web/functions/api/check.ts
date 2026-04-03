/**
 * GET /api/check?name=bread
 * Check whether a community name is available for registration.
 */

interface Env {
  TENANTS_KV: KVNamespace
  CF_ROOT_DOMAIN: string
}

function isValidName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(name)
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const name = url.searchParams.get('name')?.toLowerCase().trim() ?? ''

  if (!name) {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }

  if (!isValidName(name)) {
    return Response.json(
      { error: 'name must be 3–30 lowercase alphanumeric characters or hyphens, cannot start or end with a hyphen' },
      { status: 400 }
    )
  }

  const rootDomain = context.env.CF_ROOT_DOMAIN ?? 'forest.mushroom.cv'
  const domain = `${name}.${rootDomain}`

  let available = true
  try {
    const existing = await context.env.TENANTS_KV.get(domain)
    available = existing === null
  } catch {
    // KV unavailable — allow optimistically
  }

  return Response.json({ available, domain, name })
}
