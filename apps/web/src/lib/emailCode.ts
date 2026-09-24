/**
 * Email verification codes for self-service registration (M6-3).
 *
 * Pure and browser-free so the Cloudflare Functions and their tests share one
 * implementation. Storage holds a salted hash; the plaintext code lives in the
 * email and in memory.
 */

/** How long a code stays valid. */
export const EMAIL_CODE_TTL_SECONDS = 10 * 60
/** Wrong attempts allowed before the stored code is spent. */
export const EMAIL_CODE_MAX_ATTEMPTS = 5

export type EmailCodeRecord = {
  /** Salted SHA-256 hex of the code. */
  hash: string
  /** Unix seconds. */
  expiresAt: number
  /** Wrong attempts so far. */
  attempts: number
}

/** A fresh 6-digit code, drawn from the platform CSPRNG. */
export function generateEmailCode(): string {
  const bytes = new Uint32Array(1)
  crypto.getRandomValues(bytes)
  return String(bytes[0]! % 1_000_000).padStart(6, '0')
}

/**
 * Salted hash used for storage and for checking a submission. `secret` is a
 * server config value: a KV leak on its own does not let an attacker precompute
 * codes.
 */
export async function hashEmailCode(
  email: string,
  code: string,
  secret = ''
): Promise<string> {
  const data = new TextEncoder().encode(`${secret}:${email.trim().toLowerCase()}:${code.trim()}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Length-checked comparison that does not exit early on the first difference. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export type EmailCodeVerdict =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'expired' | 'mismatch' | 'too-many-attempts' }

/** Pure decision so the stored-record rules are easy to test. */
export function verifyEmailCode(
  record: EmailCodeRecord | null,
  submittedHash: string,
  nowSeconds: number
): EmailCodeVerdict {
  if (!record) return { ok: false, reason: 'missing' }
  if (record.expiresAt <= nowSeconds) return { ok: false, reason: 'expired' }
  if (record.attempts >= EMAIL_CODE_MAX_ATTEMPTS) return { ok: false, reason: 'too-many-attempts' }
  return timingSafeEqual(record.hash, submittedHash) ? { ok: true } : { ok: false, reason: 'mismatch' }
}
