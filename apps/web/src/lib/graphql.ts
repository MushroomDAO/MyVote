type GraphQLResponse<TData> = {
  data?: TData
  errors?: Array<{ message: string }>
}

export async function graphqlRequest<TData>(
  endpoint: string,
  query: string,
  variables?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<TData> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GraphQL HTTP ${res.status}: ${text}`)
  }

  const json = (await res.json()) as GraphQLResponse<TData>

  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '))
  }

  if (!json.data) throw new Error('Missing GraphQL data')
  return json.data
}

export type Space = {
  id: string
  name: string
  about?: string
  network?: string
  symbol?: string
}

export type ProposalListItem = {
  id: string
  title: string
  created: number
  state: string
}

export type ProposalType =
  | 'single-choice'
  | 'approval'
  | 'quadratic'
  | 'ranked-choice'
  | 'weighted'
  | 'basic'

export type Proposal = {
  id: string
  title: string
  body?: string
  choices: string[]
  type: ProposalType
  start: number
  end: number
  snapshot: string
  state: string
  author: string
  created: number
  votes: number
  scores: number[]
  scores_total: number
  space: { id: string; name: string }
}

export async function fetchSpaces(
  endpoint: string,
  params: { first: number; skip: number; signal?: AbortSignal }
) {
  // `signal` belongs to the transport, not the GraphQL variables map, so pull
  // it out here.
  const { signal, ...variables } = params
  return graphqlRequest<{ spaces: Space[] }>(
    endpoint,
    `
      query ExploreSpaces($first: Int!, $skip: Int!) {
        spaces(first: $first, skip: $skip, orderBy: "created", orderDirection: desc) {
          id
          name
          about
          network
          symbol
        }
      }
    `,
    variables,
    signal
  )
}

export async function fetchSpaceWithProposals(
  endpoint: string,
  params: {
    spaceId: string
    first: number
    skip: number
    /** Optional proposal state filter; omitted means no filter. */
    state?: string
    signal?: AbortSignal
  }
) {
  const { signal, ...variables } = params
  return graphqlRequest<{ space: Space | null; proposals: ProposalListItem[] }>(
    endpoint,
    `
      query SpacePage($spaceId: String!, $first: Int!, $skip: Int!, $state: String) {
        space(id: $spaceId) {
          id
          name
          about
          network
          symbol
        }
        proposals(
          first: $first
          skip: $skip
          where: { space_in: [$spaceId], state: $state }
          orderBy: "created"
          orderDirection: desc
        ) {
          id
          title
          created
          state
        }
      }
    `,
    variables,
    signal
  )
}

export async function fetchProposal(
  endpoint: string,
  params: { proposalId: string; signal?: AbortSignal }
) {
  const { signal, ...variables } = params
  return graphqlRequest<{ proposal: Proposal | null }>(
    endpoint,
    `
      query ProposalPage($proposalId: String!) {
        proposal(id: $proposalId) {
          id
          title
          body
          choices
          type
          start
          end
          snapshot
          state
          author
          created
          votes
          scores
          scores_total
          space {
            id
            name
          }
        }
      }
    `,
    variables,
    signal
  )
}

/** The connected account's vote on one proposal, when it has one. */
export type VoterVote = {
  id: string
  /** 1-based index for single-choice/basic; array/object for the other types. */
  choice: unknown
}

/**
 * Reads the account's existing vote. Off-chain votes may be replaced, so this
 * feeds a "you already voted" note and a prefill rather than a hard block.
 */
export async function fetchVoterVote(
  endpoint: string,
  params: { proposalId: string; voter: string; signal?: AbortSignal }
): Promise<VoterVote | null> {
  const { signal, ...variables } = params
  const data = await graphqlRequest<{ votes: VoterVote[] }>(
    endpoint,
    `
      query VoterVote($proposalId: String!, $voter: String!) {
        votes(first: 1, where: { proposal: $proposalId, voter: $voter }) {
          id
          choice
        }
      }
    `,
    variables,
    signal
  )
  return data.votes?.[0] ?? null
}
