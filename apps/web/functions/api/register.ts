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
  /** Durable Object that serialises name claims; see docs/registration-atomicity.md. */
  TENANT_REGISTRY?: TenantRegistryNamespace
  CF_ACCOUNT_ID: string
  CF_API_TOKEN: string
  CF_ZONE_ID: string
  CF_PAGES_PROJECT: string
  CF_ROOT_DOMAIN: string
  /** Snapshot Hub used to look up a space's admins for the ownership proof. */
  SNAPSHOT_HUB?: string
  /** When set, registration asks for the emailed verification code (M6-3). */
  RESEND_API_KEY?: string
  /** Salt for the stored code hash, kept in server config. */
  EMAIL_CODE_SECRET?: string
}

type RegisterBody = {
  name: string
  spaceId: string
  description?: string
  /** Registrant contact email (M4-B interim identity). Stored as contact only. */
  email?: string
  /** Code sent to `email`; required when a mail service is configured. */
  emailCode?: string
  /** Optional space-ownership proof: a personal_sign over the ownership message. */
  adminSignature?: string
  adminAddress?: string
  adminTimestamp?: number
}

// Shared with the app (single tested source) — functions are bundled by esbuild,
// so relative imports into src are fine as long as the modules stay browser-free.
import { verifyMessage } from 'viem'

import { domainOutcome } from '../../src/lib/domainRegistration'
import {
  EMAIL_CODE_TTL_SECONDS,
  hashEmailCode,
  verifyEmailCode,
  type EmailCodeRecord
} from '../../src/lib/emailCode'
import { isValidEmail } from '../../src/lib/email'
import {
  buildOwnershipMessage,
  isFreshTimestamp,
  ownershipVerdict,
  type OwnershipVerdict
} from '../../src/lib/ownership'
import { hitRateLimit } from '../../src/lib/rateLimit'
import {
  claimDomain,
  releaseDomain,
  reserveByKv,
  type TenantRegistryNamespace
} from '../../src/lib/tenantRegistry'
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

/**
 * Claims `domain` for `token`.
 *
 * With `TENANT_REGISTRY` bound this is one atomic operation in the Durable
 * Object; without it the KV fallback can race, so the binding is what closes
 * the hole (see docs/registration-atomicity.md).
 */
async function claimName(env: Env, domain: string, token: string): Promise<boolean> {
  const registry = env.TENANT_REGISTRY
  if (registry) return claimDomain(registry, domain, token)

  // KV has no compare-and-set: check first so an existing tenant record is not
  // overwritten by a losing reservation.
  const existing = await env.TENANTS_KV.get(domain)
  if (existing !== null) return false
  return reserveByKv(env.TENANTS_KV, domain, token)
}

/** Gives the name back after a registration that did not complete. */
async function releaseName(env: Env, domain: string, token: string): Promise<void> {
  if (!env.TENANT_REGISTRY) return
  await releaseDomain(env.TENANT_REGISTRY, domain, token)
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

  // --- Email verification (M6-3) ---
  // Enforced when a mail service is configured: without one there is no code to
  // check against, so the interim flow stays open and the record is marked
  // unverified.
  let emailVerified = false
  if (context.env.RESEND_API_KEY) {
    const stored = await context.env.TENANTS_KV.get(`ec:${email}`)
    let record: EmailCodeRecord | null = null
    try {
      record = stored ? (JSON.parse(stored) as EmailCodeRecord) : null
    } catch {
      record = null
    }
    const submittedHash = body.emailCode
      ? await hashEmailCode(email, body.emailCode, context.env.EMAIL_CODE_SECRET ?? '')
      : ''
    const verdict = verifyEmailCode(record, submittedHash, Math.floor(Date.now() / 1000))
    if (!verdict.ok) {
      // Count a wrong guess against the stored code to slow brute-forcing.
      if (verdict.reason === 'mismatch' && record) {
        try {
          await context.env.TENANTS_KV.put(
            `ec:${email}`,
            JSON.stringify({ ...record, attempts: record.attempts + 1 }),
            { expirationTtl: EMAIL_CODE_TTL_SECONDS }
          )
        } catch {
          // Best effort: a failed counter bump does not change the verdict.
        }
      }
      return Response.json({ error: `email_code_${verdict.reason}` }, { status: 400 })
    }
    emailVerified = true
    await context.env.TENANTS_KV.delete(`ec:${email}`)
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

  // --- Claim the name ---
  // With the Durable Object bound this is a single atomic operation; without it
  // we fall back to the KV reserve-and-read-back dance, which narrows the race
  // without closing it (see docs/registration-atomicity.md).
  const reservation = crypto.randomUUID()
  if (!(await claimName(context.env, domain, reservation))) {
    return Response.json({ error: 'This name is already taken', domain }, { status: 409 })
  }

  const token = context.env.CF_API_TOKEN
  const accountId = context.env.CF_ACCOUNT_ID
  const pagesProject = context.env.CF_PAGES_PROJECT
  const tenantConfig = {
    spaceId,
    name,
    description: description || undefined,
    // Contact only. _middleware allowlists which fields reach window.__TENANT__,
    // so this never becomes public page source.
    contactEmail: email,
    // 'verified' | 'unverified' — see lib/ownership.ts.
    ownership,
    // Set when a code was checked and accepted (M6-3).
    emailVerified,
    createdAt: new Date().toISOString(),
    _reservation: reservation,
  }
  try {
    await context.env.TENANTS_KV.put(domain, JSON.stringify(tenantConfig))
  } catch (error) {
    // Publishing the record failed: give the name back before surfacing it.
    await releaseName(context.env, domain, reservation)
    throw error
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
    // nothing. Undo the write, release the claim and fail loudly so the user can
    // retry the name.
    await context.env.TENANTS_KV.delete(domain)
    await releaseName(context.env, domain, reservation)
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
