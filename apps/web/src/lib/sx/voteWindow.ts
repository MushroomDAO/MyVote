/**
 * How long until an SX proposal's voting window next changes state.
 *
 * The indexer's `state` is a snapshot; the local window (`start` / `max_end`) is
 * what actually opens and closes voting. A timer aimed at the next boundary lets
 * the submit button flip without a page reload. Delays are capped so a far-away
 * boundary is re-checked hourly rather than trusted for days.
 */
export const SX_WINDOW_MAX_DELAY_MS = 60 * 60 * 1000

export function msUntilWindowChange(
  start: number,
  maxEnd: number,
  nowSeconds: number
): number | null {
  const boundary = nowSeconds < start ? start : maxEnd
  const ms = (boundary - nowSeconds) * 1000 + 1000
  if (ms <= 0) return null
  return Math.min(ms, SX_WINDOW_MAX_DELAY_MS)
}
