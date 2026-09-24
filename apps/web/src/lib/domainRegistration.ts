/**
 * How to finish a registration once the Cloudflare Pages domain call returns.
 *
 * Extracted from the edge handler so the decision — keep the tenant active, mark
 * the domain unmanaged, or roll the KV write back — is unit-tested without the
 * Workers runtime.
 */
export type DomainOutcome =
  | { kind: 'active' }
  | { kind: 'unmanaged' }
  | { kind: 'rollback'; detail: string }

export type CfResult = { success: boolean; errors?: { message: string }[] } | null

export function domainOutcome(configured: boolean, result: CfResult): DomainOutcome {
  if (!configured) return { kind: 'unmanaged' }
  if (result?.success) return { kind: 'active' }
  const detail = result?.errors?.map((e) => e.message).join('; ') || 'unknown error'
  return { kind: 'rollback', detail }
}
