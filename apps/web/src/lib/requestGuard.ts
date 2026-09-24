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
  /** Starts a new request, invalidating (and aborting) every earlier one. */
  next(): number
  /** True when `token` is still the most recently issued token. */
  isCurrent(token: number): boolean
  /**
   * Signal for the newest request. It aborts as soon as a newer request starts,
   * so superseded network work stops instead of finishing into nothing.
   */
  readonly signal: AbortSignal
  /**
   * Aborts the newest request and invalidates its token — call on unmount so a
   * late response neither writes state nor surfaces as an AbortError.
   */
  abort(): void
}

export function createRequestGuard(): RequestGuard {
  let current = 0
  let controller = new AbortController()
  return {
    next() {
      controller.abort()
      controller = new AbortController()
      return ++current
    },
    isCurrent(token: number) {
      return token === current
    },
    get signal() {
      return controller.signal
    },
    abort() {
      controller.abort()
      // Bumping the token matters: abort() has no successor request, so
      // isCurrent() would otherwise stay true and the aborted loader would run
      // its catch/finally as if the failure were real.
      current++
    }
  }
}
