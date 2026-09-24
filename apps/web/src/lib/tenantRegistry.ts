/**
 * Pages-side half of the registration lock.
 *
 * `TENANT_REGISTRY` binds to the Durable Object in `apps/tenant-registry/src/index.ts`
 * (Cloudflare Pages Functions cannot define a DO class themselves). The HTTP
 * contract lives in both files — keep them in sync.
 *
 * Why this exists: KV has no compare-and-set, so two concurrent `/api/register`
 * calls can both pass a uniqueness check. One claim per name routes through one
 * single-threaded object, which serialises them. See docs/registration-atomicity.md.
 */

export type TenantRegistryStub = {
  fetch(request: Request): Promise<Response>
}

/**
 * The slice of KV the fallback uses. Kept structural (like lib/rateLimit.ts's
 * KVLike) so this module carries no Workers ambient types and the DOM tsconfig
 * project can compile it.
 */
export type ClaimStore = {
  get<T>(key: string, type: 'json'): Promise<T | null>
  put(key: string, value: string): Promise<void>
}

export type TenantRegistryNamespace = {
  idFromName(name: string): unknown
  get(id: unknown): TenantRegistryStub
}

const REGISTRY_URL = 'https://tenant-registry'

function lockRequest(path: string, domain: string, token: string): Request {
  return new Request(`${REGISTRY_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domain, token })
  })
}

/** Claims `domain` for `token`; false when another registration holds it. */
export async function claimDomain(
  registry: TenantRegistryNamespace,
  domain: string,
  token: string
): Promise<boolean> {
  const stub = registry.get(registry.idFromName(domain))
  const response = await stub.fetch(lockRequest('/claim', domain, token))
  if (!response.ok) throw new Error(`tenant registry claim failed with ${response.status}`)
  const body = (await response.json()) as { ok?: boolean }
  return body.ok === true
}

/**
 * Releases a claim held by `token`. The object ignores a token it does not hold,
 * so a rollback leaves other holders untouched. Best effort: a failed release
 * does not replace the caller's original error.
 */
export async function releaseDomain(
  registry: TenantRegistryNamespace,
  domain: string,
  token: string
): Promise<void> {
  try {
    const stub = registry.get(registry.idFromName(domain))
    await stub.fetch(lockRequest('/release', domain, token))
  } catch {
    // Best effort.
  }
}

/**
 * Fallback for when `TENANT_REGISTRY` is unbound (minimal local setups, unit
 * tests). KV has no compare-and-set, so this narrows the race without closing
 * it — it exists so the binding can be rolled out and rolled back safely.
 */
export async function reserveByKv(
  kv: ClaimStore,
  domain: string,
  token: string
): Promise<boolean> {
  await kv.put(domain, JSON.stringify({ _reservation: token }))
  const stored = await kv.get<{ _reservation?: string }>(domain, 'json')
  return stored?._reservation === token
}
