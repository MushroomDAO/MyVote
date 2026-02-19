type GraphQLResponse<TData> = {
  data?: TData
  errors?: Array<{ message: string }>
}

export async function graphqlRequest<TData>(
  endpoint: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<TData> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
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
  space: { id: string; name: string }
}

export async function fetchSpaces(endpoint: string, params: { first: number; skip: number }) {
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
    params
  )
}

export async function fetchSpaceWithProposals(
  endpoint: string,
  params: { spaceId: string; first: number; skip: number }
) {
  return graphqlRequest<{ space: Space | null; proposals: ProposalListItem[] }>(
    endpoint,
    `
      query SpacePage($spaceId: String!, $first: Int!, $skip: Int!) {
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
          where: { space_in: [$spaceId] }
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
    params
  )
}

export async function fetchProposal(endpoint: string, params: { proposalId: string }) {
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
          space {
            id
            name
          }
        }
      }
    `,
    params
  )
}
