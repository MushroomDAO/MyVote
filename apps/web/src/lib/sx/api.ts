import {
  SX_API_DEFAULT,
  type SxEvmNetworkId,
  type SxStrategyConfig,
  type SxVoteRequest
} from './types'

/**
 * Read path for Snapshot X, against the official multi-chain indexer
 * (`https://api.snapshot.box`). This is *additive*: the off-chain Hub GraphQL
 * stays the default read path, and SX data only loads for SX spaces.
 *
 * Field selection mirrors @snapshot-labs/sx's own UI, verified against live
 * Optimism spaces (e.g. 0x03C7431e14F7b759Aa44398AD7901e6053c197Bf).
 */

// Built with string concatenation (no template literals) so GraphQL field
// blocks stay readable without escaping.
const STRATEGY_FIELDS =
  'strategies_indices strategies strategies_params'

const SPACE_FIELDS =
  'id protocol metadata { name about } authenticators vp_decimals proposal_count _indexer ' +
  STRATEGY_FIELDS

export const SX_SPACE_QUERY =
  'query Space($id: String!) { space(id: $id) { ' + SPACE_FIELDS + ' } }'

export const SX_PROPOSALS_QUERY =
  'query Proposals($space: String!, $first: Int!, $skip: Int!) { ' +
  'proposals(first: $first, skip: $skip, orderBy: created, orderDirection: desc, where: { space: $space }) { ' +
  'id proposal_id metadata { title body choices } state snapshot start min_end max_end ' +
  'scores_total vote_count ' +
  STRATEGY_FIELDS +
  ' } }'

export const SX_PROPOSAL_QUERY =
  'query Proposal($id: String!) { proposal(id: $id) { ' +
  'id proposal_id type metadata { title body choices } state snapshot start min_end max_end ' +
  'scores_1_parsed scores_2_parsed scores_3_parsed scores_total_parsed vote_count _indexer ' +
  STRATEGY_FIELDS +
  ' space { id metadata { name } authenticators ' + STRATEGY_FIELDS + ' } ' +
  ' } }'

/** Raw wire shapes (strings for big numbers, as the indexer returns them). */
export type SxSpaceWire = {
  id: string
  protocol: string
  metadata: { name: string | null; about: string | null } | null
  authenticators: string[]
  vp_decimals: number
  proposal_count: number
  _indexer: string
  strategies_indices: number[]
  strategies: string[]
  strategies_params: string[]
}

export type SxProposalWire = {
  id: string
  proposal_id: string
  type: string
  metadata: { title: string | null; body: string | null; choices: string[] } | null
  state: string
  snapshot: string | null
  start: string
  min_end: string
  max_end: string
  /** Per-choice scores; the indexer exposes up to three choices. */
  scores_1_parsed: number | null
  scores_2_parsed: number | null
  scores_3_parsed: number | null
  scores_total_parsed: number | null
  vote_count: number
  _indexer: string
  strategies_indices: number[]
  strategies: string[]
  strategies_params: string[]
  space?: {
    id: string
    metadata?: { name: string | null } | null
    authenticators: string[]
  } & Pick<SxSpaceWire, 'strategies_indices' | 'strategies' | 'strategies_params'>
}

/** Indexer chain code → sx.js network id. */
const INDEXER_TO_NETWORK: Record<string, SxEvmNetworkId> = {
  eth: 'ethereum',
  oeth: 'optimism',
  arb1: 'arbitrum',
  base: 'base',
  sep: 'sepolia'
}

/** Maps the indexer's chain code (`oeth`) to an sx.js network id (`optimism`). */
export function sxNetworkFromIndexer(indexer: string | null | undefined): SxEvmNetworkId | null {
  if (!indexer) return null
  return INDEXER_TO_NETWORK[indexer] ?? null
}

export type SxSpace = {
  id: string
  name: string | null
  about: string | null
  network: SxEvmNetworkId | null
  authenticators: string[]
  vpDecimals: number
  proposalCount: number
  strategies: SxStrategyConfig[]
}

export type SxProposal = {
  /** Composite id, `<space>/<proposal_id>`. */
  id: string
  proposalId: number
  network: SxEvmNetworkId | null
  /** SX proposal type, e.g. `basic` (see sx.js vote types). */
  type: string
  title: string | null
  body: string | null
  choices: string[]
  state: string
  snapshot: number | null
  start: number
  end: number
  /** Per-choice scores (the indexer exposes up to three). */
  scores: number[]
  scoresTotal: number
  voteCount: number
  strategies: SxStrategyConfig[]
  /** Present when the proposal was fetched with its space (single-proposal query). */
  space: {
    id: string
    name: string | null
    authenticators: string[]
    strategies: SxStrategyConfig[]
  } | null
}

/**
 * Zips the indexer's parallel arrays into strategy configs. Missing tails fall
 * back to sensible empties rather than throwing — the indexer has been observed
 * to omit `strategies_params` for some spaces.
 */
export function zipStrategies(
  indices: number[] = [],
  addresses: string[] = [],
  params: string[] = []
): SxStrategyConfig[] {
  return indices.map((index, i) => ({
    index,
    address: addresses[i] ?? '',
    params: params[i] ?? '0x'
  }))
}

export function toSxSpace(wire: SxSpaceWire): SxSpace {
  return {
    id: wire.id,
    name: wire.metadata?.name ?? null,
    about: wire.metadata?.about ?? null,
    authenticators: wire.authenticators ?? [],
    network: sxNetworkFromIndexer(wire._indexer),
    vpDecimals: wire.vp_decimals ?? 0,
    proposalCount: wire.proposal_count ?? 0,
    strategies: zipStrategies(wire.strategies_indices, wire.strategies, wire.strategies_params)
  }
}

export function toSxProposal(wire: SxProposalWire): SxProposal {
  return {
    id: wire.id,
    proposalId: Number.parseInt(wire.proposal_id, 10),
    network: sxNetworkFromIndexer(wire._indexer),
    type: wire.type ?? 'basic',
    title: wire.metadata?.title ?? null,
    body: wire.metadata?.body ?? null,
    choices: wire.metadata?.choices ?? [],
    state: wire.state,
    snapshot: wire.snapshot === null ? null : Number.parseInt(wire.snapshot, 10),
    start: Number.parseInt(wire.start, 10),
    end: Number.parseInt(wire.min_end, 10),
    scores: [
      wire.scores_1_parsed ?? 0,
      wire.scores_2_parsed ?? 0,
      wire.scores_3_parsed ?? 0
    ],
    scoresTotal: wire.scores_total_parsed ?? 0,
    voteCount: wire.vote_count ?? 0,
    strategies: zipStrategies(wire.strategies_indices, wire.strategies, wire.strategies_params),
    space: wire.space
      ? {
          id: wire.space.id,
          name: wire.space.metadata?.name ?? null,
          authenticators: wire.space.authenticators ?? [],
          strategies: zipStrategies(
            wire.space.strategies_indices,
            wire.space.strategies,
            wire.space.strategies_params
          )
        }
      : null
  }
}

/**
 * Builds the sx.js `Vote` payload from indexed space/proposal data.
 *
 * The space's first authenticator is the one votes are signed for. SX has no
 * proposal "type" — the choice is the raw index/indices.
 */
export function buildSxVoteRequest(input: {
  spaceId: string
  authenticators: string[]
  strategies: SxStrategyConfig[]
  proposalId: number
  choice: number | number[] | Record<string, number>
  metadataUri?: string
}): SxVoteRequest {
  const authenticator = input.authenticators[0]
  if (!authenticator) throw new Error('SX space has no authenticator')

  return {
    space: input.spaceId,
    authenticator,
    strategies: input.strategies,
    proposal: input.proposalId,
    choice: input.choice,
    metadataUri: input.metadataUri ?? ''
  }
}

export async function sxGraphqlRequest<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables })
  })

  const text = await response.text()
  let payload: unknown
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new Error('SX indexer returned non-JSON (' + response.status + ')')
  }

  if (!response.ok) {
    throw new Error('SX indexer error (' + response.status + ')')
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('SX indexer returned an invalid response')
  }

  const { data, errors } = payload as { data?: unknown; errors?: { message: string }[] }
  if (errors?.length) {
    throw new Error('SX indexer: ' + errors.map((e) => e.message).join('; '))
  }
  if (data === undefined) throw new Error('SX indexer returned no data')
  return data as T
}

export async function fetchSxSpace(
  endpoint: string = SX_API_DEFAULT,
  spaceId: string,
  fetchImpl: typeof fetch = fetch
): Promise<SxSpace | null> {
  const data = await sxGraphqlRequest<{ space: SxSpaceWire | null }>(
    endpoint,
    SX_SPACE_QUERY,
    { id: spaceId },
    fetchImpl
  )
  return data.space ? toSxSpace(data.space) : null
}

export async function fetchSxProposals(
  endpoint: string = SX_API_DEFAULT,
  spaceId: string,
  options: { first?: number; skip?: number } = {},
  fetchImpl: typeof fetch = fetch
): Promise<SxProposal[]> {
  const data = await sxGraphqlRequest<{ proposals: SxProposalWire[] }>(
    endpoint,
    SX_PROPOSALS_QUERY,
    { space: spaceId, first: options.first ?? 20, skip: options.skip ?? 0 },
    fetchImpl
  )
  return (data.proposals ?? []).map(toSxProposal)
}

export async function fetchSxProposal(
  endpoint: string = SX_API_DEFAULT,
  proposalId: string,
  fetchImpl: typeof fetch = fetch
): Promise<SxProposal | null> {
  const data = await sxGraphqlRequest<{ proposal: SxProposalWire | null }>(
    endpoint,
    SX_PROPOSAL_QUERY,
    { id: proposalId },
    fetchImpl
  )
  return data.proposal ? toSxProposal(data.proposal) : null
}
