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
  /** Snapshot Hub used to look up a space's admins for the ownership proof. */
  SNAPSHOT_HUB?: string
}

type RegisterBody = {
  name: string
  spaceId: string
  description?: string
  /** Registrant contact email (M4-B interim identity). Stored as contact only. */
  email?: string
  /** Optional space-ownership proof: a personal_sign over the ownership message. */
  adminSignature?: string
  adminAddress?: string
  adminTimestamp?: number
}

// Shared with the app (single tested source) — functions are bundled by esbuild,
// so relative imports into src are fine as long as the modules stay browser-free.
import { verifyMessage } from 'viem'

import { domainOutcome } from '../../src/lib/domainRegistration'
import { isValidEmail } from '../../src/lib/email'
import {
  buildOwnershipMessage,
  isFreshTimestamp,
  ownershipVerdict,
  type OwnershipVerdict
} from '../../src/lib/ownership'
import { hitRateLimit } from '../../src/lib/rateLimit'
import { isValidSpaceId, isValidSubdomain } from '../../src/lib/registration'

/** Registration attempts allowed per IP per hour. */
const REGISTER_LIMIT = 5

/** Keep in sync with the frontend's VITE_SNAPSHOT_HUB. */
const DEFAULT_SNAPSHOT_HUB = 'https://testnet.hub.snapshot.org'

/** Space admins, or null when the Hub could not answer. */
async function fetchSpaceAdmins(hubUrl: string, spaceId: string): Promise<string[] | null> {
  try {
    const res = await fetch(hubUrl.replace(/\/+$/, '') + '/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'query SpaceAdmins($id: String!) { space(id: $id) { admins } }',
        variables: { id: spaceId }
      })
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: { space?: { admins?: unknown } } }
    const admins = json?.data?.space?.admins
    return Array.isArray(admins) ? (admins as string[]) : null
  } catch {
    return null
  }
}

/**
 * Resolves the ownership verdict for a registration.
 *
 * No proof → 'unverified' (the existing flow is unchanged). A supplied proof is
 * an assertion: a bad signature, a stale timestamp, a non-admin signer, or a Hub
 * we cannot reach all yield 'reject'.
 */
async function resolveOwnership(
  hubUrl: string,
  input: {
    domain: string
    spaceId: string
    adminSignature?: string
    adminAddress?: string
    adminTimestamp?: number
  }
): Promise<OwnershipVerdict> {
  const provided = Boolean(input.adminSignature && input.adminAddress && input.adminTimestamp)
  if (!provided) return ownershipVerdict({ proofProvided: false, signerIsAdmin: null })

  const signature = input.adminSignature as string
  const address = input.adminAddress as string
  const timestamp = input.adminTimestamp as number

  if (!isFreshTimestamp(timestamp, Date.now())) return 'reject'

  let valid = false
  try {
    valid = await verifyMessage({
      address: address as `0x${string}`,
      message: buildOwnershipMessage(input.domain, timestamp),
      signature: signature as `0x${string}`
    })
  } catch {
    return 'reject'
  }
  if (!valid) return 'reject'

  const admins = await fetchSpaceAdmins(hubUrl, input.spaceId)
  const signerIsAdmin =
    admins === null ? null : admins.some((a) => a.toLowerCase() === address.toLowerCase())

  return ownershipVerdict({ proofProvided: true, signerIsAdmin })
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

  // --- Rate limit (best effort; KV has no atomic increment) ---
  const ip = context.request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const rate = await hitRateLimit(
    context.env.TENANTS_KV,
    `rl:register:${ip}`,
    REGISTER_LIMIT,
    3600
  )
  if (rate.limited) {
    return Response.json(
      { error: 'Too many registration attempts, try again later' },
      { status: 429 }
    )
  }

  // --- Validation ---
  if (!name) return Response.json({ error: 'name is required' }, { status: 400 })
  if (!isValidSubdomain(name)) {
    return Response.json(
      { error: 'name must be 3–30 lowercase alphanumeric characters or hyphens' },
      { status: 400 }
    )
  }
  if (!spaceId) return Response.json({ error: 'spaceId is required' }, { status: 400 })
  if (!isValidSpaceId(spaceId)) {
    return Response.json({ error: 'spaceId is invalid' }, { status: 400 })
  }
  if (!email) return Response.json({ error: 'email is required' }, { status: 400 })
  if (!isValidEmail(email)) {
    return Response.json({ error: 'email is invalid' }, { status: 400 })
  }

  const rootDomain = context.env.CF_ROOT_DOMAIN ?? 'forest.mushroom.cv'
  const domain = `${name}.${rootDomain}`

  // --- Ownership proof (optional; reject only when a proof is asserted) ---
  const ownership = await resolveOwnership(context.env.SNAPSHOT_HUB ?? DEFAULT_SNAPSHOT_HUB, {
    domain,
    spaceId,
    adminSignature: body.adminSignature,
    adminAddress: body.adminAddress,
    adminTimestamp: body.adminTimestamp
  })
  if (ownership === 'reject') {
    return Response.json(
      { error: 'Space ownership proof was rejected', domain },
      { status: 400 }
    )
  }

  // --- Uniqueness check ---
  const existing = await context.env.TENANTS_KV.get(domain)
  if (existing !== null) {
    return Response.json({ error: 'This name is already taken', domain }, { status: 409 })
  }

  const token = context.env.CF_API_TOKEN
  const accountId = context.env.CF_ACCOUNT_ID
  const pagesProject = context.env.CF_PAGES_PROJECT

  // --- Write to KV (reserve, then confirm) ---
  // KV has no compare-and-set, so two concurrent requests can both pass the
  // uniqueness check above. Write a random token and read it back: the last
  // writer wins, so the loser sees a foreign token and backs off. This narrows,
  // but cannot fully close, the race — a hard guarantee needs Durable Objects.
  const reservation = crypto.randomUUID()
  const tenantConfig = {
    spaceId,
    name,
    description: description || undefined,
    // Contact only. _middleware allowlists which fields reach window.__TENANT__,
    // so this never becomes public page source.
    contactEmail: email,
    // 'verified' | 'unverified' — see lib/ownership.ts.
    ownership,
    createdAt: new Date().toISOString(),
    _reservation: reservation,
  }
  await context.env.TENANTS_KV.put(domain, JSON.stringify(tenantConfig))

  const stored = await context.env.TENANTS_KV.get<{ _reservation?: string }>(domain, 'json')
  if (stored?._reservation !== reservation) {
    return Response.json({ error: 'This name is already taken', domain }, { status: 409 })
  }

  // --- Register the custom domain on the Pages project (issues the SSL cert) ---
  // The wildcard DNS record (*.<root>) already exists; only the per-domain Pages
  // registration is needed to enable HTTPS for this subdomain.
  const configured = Boolean(token && accountId && pagesProject)
  const outcome = configured
    ? domainOutcome(
        true,
        await cfApi(
          token,
          `/accounts/${accountId}/pages/projects/${pagesProject}/domains`,
          'POST',
          { name: domain }
        )
      )
    : domainOutcome(false, null)

  if (outcome.kind === 'rollback') {
    // A KV entry whose domain never got registered looks "taken" but serves
    // nothing. Undo the write and fail loudly so the user can retry the name.
    await context.env.TENANTS_KV.delete(domain)
    return Response.json(
      {
        error: 'Custom domain registration failed, please try again',
        domain,
        detail: outcome.detail,
      },
      { status: 502 }
    )
  }

  // Record whether the domain is actually wired up on this Pages project.
  await context.env.TENANTS_KV.put(
    domain,
    JSON.stringify({ ...tenantConfig, domainStatus: outcome.kind })
  )

  return Response.json({
    success: true,
    domain,
    url: `https://${domain}`,
    spaceId,
    name,
    domainStatus: outcome.kind,
    ownership,
  })
}
