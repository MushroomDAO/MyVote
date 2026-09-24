/**
 * Picks the vote protocol for a space.
 *
 * Off-chain Snapshot spaces are ENS names (`yam.eth`); Snapshot X spaces are
 * deployed contracts (`0x…`). This is a heuristic for the routing seam added in
 * M5 — once spaces carry explicit protocol metadata, prefer that source.
 */
export type VoteProtocol = 'snapshot-offchain' | 'snapshot-x'

const SX_SPACE_ID = /^0x[0-9a-fA-F]{40}$/

export function protocolForSpaceId(spaceId: string): VoteProtocol {
  return SX_SPACE_ID.test(spaceId.trim()) ? 'snapshot-x' : 'snapshot-offchain'
}
