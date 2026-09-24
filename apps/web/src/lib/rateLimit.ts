/**
 * Fixed-window rate limiter backed by a KV-like store.
 *
 * Cloudflare KV has no atomic increment and is eventually consistent, so this is
 * a best-effort abuse guard, not a hard quota: under concurrency a couple of
 * extra requests may slip through. That is acceptable for the registration and
 * availability endpoints; a precise limit would need Durable Objects.
 *
 * A fixed window keeps the store shape trivial: one counter key per window,
 * self-expiring via the store's expirationTtl option.
 */
export type KVLike = {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export type RateLimitResult = {
  limited: boolean
  /** Requests counted in the current window, including this one. */
  count: number
}

export async function hitRateLimit(
  kv: KVLike,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const raw = await kv.get(key)
  const parsed = Number.parseInt(raw ?? '0', 10)
  const previous = Number.isFinite(parsed) && parsed > 0 ? parsed : 0

  if (previous >= limit) {
    return { limited: true, count: previous }
  }

  await kv.put(key, String(previous + 1), { expirationTtl: windowSeconds })
  return { limited: false, count: previous + 1 }
}
