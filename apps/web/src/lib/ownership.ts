/**
 * Snapshot space ownership proof for self-service registration.
 *
 * Non-breaking by design: registration still works without a proof (recorded as
 * `unverified`). Supplying a proof is an **assertion** — if it does not check
 * out, registration is rejected rather than silently downgraded.
 *
 * The proof is a plain EIP-191 message (personal_sign) so any wallet can produce
 * it, plus a fresh timestamp to bound replay.
 */

export const OWNERSHIP_MESSAGE_PREFIX = 'myvote:register'

/** How long a signed ownership proof stays valid. */
export const OWNERSHIP_MAX_AGE_MS = 10 * 60 * 1000

/** Clock skew we tolerate for a "future" timestamp. */
const OWNERSHIP_FUTURE_SKEW_MS = 60 * 1000

/** The exact message a space admin signs to prove control of `domain`. */
export function buildOwnershipMessage(domain: string, timestamp: number): string {
  return `${OWNERSHIP_MESSAGE_PREFIX}:${domain}:${timestamp}`
}

/** True when the timestamp is a finite number and within the freshness window. */
export function isFreshTimestamp(
  timestamp: number,
  now: number,
  maxAgeMs = OWNERSHIP_MAX_AGE_MS
): boolean {
  if (!Number.isFinite(timestamp)) return false
  if (timestamp > now + OWNERSHIP_FUTURE_SKEW_MS) return false
  return now - timestamp <= maxAgeMs
}

export type OwnershipVerdict = 'verified' | 'unverified' | 'reject'

/**
 * Decides what to record for a registration.
 *
 * - no proof supplied → `unverified` (allowed; the existing flow)
 * - proof supplied and the signer is a space admin → `verified`
 * - proof supplied but the signer is not an admin → `reject`
 *
 * `signerIsAdmin` is `null` when it could not be determined; with a proof that
 * is a rejection (we refuse to claim a verification we could not check).
 */
export function ownershipVerdict(input: {
  proofProvided: boolean
  signerIsAdmin: boolean | null
}): OwnershipVerdict {
  if (!input.proofProvided) return 'unverified'
  return input.signerIsAdmin === true ? 'verified' : 'reject'
}
