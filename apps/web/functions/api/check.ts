/**
 * GET /api/check?name=bread
 * Check whether a community name is available for registration.
 */

import { hitRateLimit } from '../../src/lib/rateLimit'
import { isValidSubdomain } from '../../src/lib/registration'

interface Env {
  TENANTS_KV: KVNamespace
  CF_ROOT_DOMAIN: string
}

/** Availability checks allowed per IP per minute (the UI debounces this). */
const CHECK_LIMIT = 120

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const name = url.searchParams.get('name')?.toLowerCase().trim() ?? ''

  if (!name) {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }

  const ip = context.request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const rate = await hitRateLimit(context.env.TENANTS_KV, `rl:check:${ip}`, CHECK_LIMIT, 60)
  if (rate.limited) {
    return Response.json({ error: 'Too many checks, slow down' }, { status: 429 })
  }

  if (!isValidSubdomain(name)) {
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
