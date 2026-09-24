/**
 * Stale-response guard for async loaders.
 *
 * A page that reloads on a route-param change reuses the same component instance,
 * so an older request can resolve after a newer one and overwrite the newer
 * state (Vue Router reuses SpacePage/ProposalPage across /space/:id changes).
 *
 * A loader takes a token before awaiting and checks `isCurrent(token)` after;
 * a superseded loader returns without touching state. Tokens are monotonic, so
 * "current" always means "the most recently started request".
 */
export type RequestGuard = {
  /** Starts a new request, invalidating every earlier one. */
  next(): number
  /** True when `token` is still the most recently issued token. */
  isCurrent(token: number): boolean
}

export function createRequestGuard(): RequestGuard {
  let current = 0
  return {
    next() {
      return ++current
    },
    isCurrent(token: number) {
      return token === current
    }
  }
}
