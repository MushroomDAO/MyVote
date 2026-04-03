/**
 * GET /api/status?name=bread
 * Check registration status of a community.
 */

interface Env {
  TENANTS_KV: KVNamespace
  CF_ROOT_DOMAIN: string
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const name = url.searchParams.get('name')?.toLowerCase().trim() ?? ''

  if (!name) {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }

  const rootDomain = context.env.CF_ROOT_DOMAIN ?? 'forest.mushroom.cv'
  const domain = `${name}.${rootDomain}`

  const raw = await context.env.TENANTS_KV.get(domain)
  if (!raw) {
    return Response.json({ exists: false, domain })
  }

  const config = JSON.parse(raw)
  return Response.json({
    exists: true,
    domain,
    url: `https://${domain}`,
    spaceId: config.spaceId,
    name: config.name,
    description: config.description,
    createdAt: config.createdAt,
  })
}
