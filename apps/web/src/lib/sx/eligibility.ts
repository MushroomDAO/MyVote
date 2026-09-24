/**
 * Pre-flight for an on-chain (Snapshot X) vote.
 *
 * Signing and relaying a vote that cannot be accepted wastes the user's
 * signature and surfaces an opaque relayer error. These are the cheap, local
 * checks we can do first — voting power itself is only known on-chain, so this
 * is a necessary-but-not-sufficient guard.
 */
export type SxVoteBlock = 'closed' | 'not-started' | 'no-authenticator'

export function sxVoteBlock(
  input: {
    state: string
    /** Unix seconds. */
    start: number
    /** Unix seconds — SX voting stays open until `max_end`. */
    maxEnd: number
    hasAuthenticator: boolean
  },
  nowSeconds: number
): SxVoteBlock | null {
  if (!input.hasAuthenticator) return 'no-authenticator'
  // The indexer's state is authoritative; the window is a secondary guard.
  if (input.state.toLowerCase() === 'closed') return 'closed'
  if (nowSeconds < input.start) return 'not-started'
  if (nowSeconds > input.maxEnd) return 'closed'
  return null
}
