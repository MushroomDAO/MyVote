/**
 * Shared Snapshot X types and endpoints.
 *
 * The backend-facing shapes live in \`./backend\`; this module re-exports the ones
 * the read path needs and pins the official indexer URL, so \`backend.ts\` and
 * \`api.ts\` do not have to import each other's internals.
 */
export type { SxStrategyConfig, SxVoteRequest, SxVoteBackend, SxEvmNetworkId } from './backend'
export { SX_EVM_CHAIN_IDS, SX_MANA_URL, SX_WHITELIST_URL } from './backend'

/** Proposal state as the indexer's `ProposalState` enum exposes it. */
export type SxProposalState = 'pending' | 'active' | 'closed'

/** Official Snapshot X multi-chain indexer (Checkpoint-based GraphQL). */
export const SX_API_DEFAULT = 'https://api.snapshot.box'
