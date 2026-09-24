/**
 * Shared validation for self-service community registration.
 *
 * Lives in `src` so the Vue page and the Cloudflare Functions can import the
 * same tested rules (Functions are bundled by esbuild and may import from src
 * when the module stays browser-free — this file is pure).
 */

/**
 * Community subdomain label: 3–30 chars, lowercase alphanumerics and hyphens,
 * never starting or ending with a hyphen.
 */
export function isValidSubdomain(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(name.trim().toLowerCase())
}

/**
 * Snapshot space id. Off-chain spaces are ENS names (`yam.eth`); Snapshot X
 * spaces are hex addresses (`0x...`). Accept both, reject whitespace and
 * separators that would only ever be a typo.
 */
export function isValidSpaceId(value: string): boolean {
  const id = value.trim()
  if (!id || id.length > 100) return false
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)
}
