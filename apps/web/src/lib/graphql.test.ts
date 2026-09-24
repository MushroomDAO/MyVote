import { describe, expect, it, vi } from 'vitest'

import {
  fetchProposal,
  fetchSpaceWithProposals,
  fetchSpaces,
  fetchVoterVote,
  graphqlRequest
} from './graphql'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/** Stubs global fetch and returns the mock so callers can inspect it. */
function stubFetch(payload: unknown, status = 200) {
  const fetchImpl = vi.fn().mockResolvedValue(
    typeof payload === 'string' ? new Response(payload, { status }) : jsonResponse(payload, status)
  )
  vi.stubGlobal('fetch', fetchImpl)
  return fetchImpl
}

describe('graphqlRequest', () => {
  it('POSTs the query and variables and returns data', async () => {
    const fetchImpl = stubFetch({ data: { ok: true } })

    await expect(graphqlRequest('https://hub.test/graphql', 'query Q', { a: 1 })).resolves.toEqual({
      ok: true
    })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://hub.test/graphql')
    expect(JSON.parse(init.body as string)).toEqual({ query: 'query Q', variables: { a: 1 } })
    expect(init.method).toBe('POST')
  })

  it('throws on a non-2xx response', async () => {
    stubFetch('boom', 500)
    await expect(graphqlRequest('https://hub.test/graphql', 'q')).rejects.toThrow(/500/)
  })

  it('surfaces GraphQL errors', async () => {
    stubFetch({ errors: [{ message: 'bad query' }] })
    await expect(graphqlRequest('https://hub.test/graphql', 'q')).rejects.toThrow(/bad query/)
  })

  it('throws when data is missing', async () => {
    stubFetch({})
    await expect(graphqlRequest('https://hub.test/graphql', 'q')).rejects.toThrow(/Missing GraphQL data/)
  })

  it('forwards an abort signal to fetch', async () => {
    const fetchImpl = stubFetch({ data: { ok: true } })
    const controller = new AbortController()

    await graphqlRequest('https://hub.test/graphql', 'q', undefined, controller.signal)

    const init = fetchImpl.mock.calls[0]![1] as RequestInit
    expect(init.signal).toBe(controller.signal)
  })
})

describe('query wrappers', () => {
  it('fetchSpaces maps the spaces array', async () => {
    stubFetch({ data: { spaces: [{ id: 'a.eth', name: 'A' }] } })
    await expect(fetchSpaces('https://hub.test/graphql', { first: 10, skip: 0 })).resolves.toEqual({
      spaces: [{ id: 'a.eth', name: 'A' }]
    })
  })

  it('fetchSpaceWithProposals passes spaceId/first/skip', async () => {
    const fetchImpl = stubFetch({ data: { space: { id: 'a.eth', name: 'A' }, proposals: [] } })
    await fetchSpaceWithProposals('https://hub.test/graphql', {
      spaceId: 'a.eth',
      first: 20,
      skip: 40
    })
    const body = JSON.parse((fetchImpl.mock.lastCall![1] as RequestInit).body as string)
    expect(body.variables).toEqual({ spaceId: 'a.eth', first: 20, skip: 40 })
  })

  it('passes an optional state filter and omits it when absent', async () => {
    const withState = stubFetch({ data: { space: null, proposals: [] } })
    await fetchSpaceWithProposals('https://hub.test/graphql', {
      spaceId: 'a.eth',
      first: 21,
      skip: 0,
      state: 'active'
    })
    let body = JSON.parse((withState.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.variables).toEqual({ spaceId: 'a.eth', first: 21, skip: 0, state: 'active' })
    expect(body.query).toContain('$state: String')
    expect(body.query).toContain('state: $state')

    const without = stubFetch({ data: { space: null, proposals: [] } })
    await fetchSpaceWithProposals('https://hub.test/graphql', { spaceId: 'a.eth', first: 21, skip: 0 })
    body = JSON.parse((without.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.variables).toEqual({ spaceId: 'a.eth', first: 21, skip: 0 })
  })

  it('fetchProposal returns the proposal', async () => {
    stubFetch({ data: { proposal: { id: '0x1', title: 'T' } } })
    await expect(
      fetchProposal('https://hub.test/graphql', { proposalId: '0x1' })
    ).resolves.toEqual({ proposal: { id: '0x1', title: 'T' } })
  })

  it('keeps the signal out of the GraphQL variables', async () => {
    const fetchImpl = stubFetch({ data: { proposal: { id: '0x1' } } })
    const controller = new AbortController()

    await fetchProposal('https://hub.test/graphql', {
      proposalId: '0x1',
      signal: controller.signal
    })

    const init = fetchImpl.mock.calls[0]![1] as RequestInit
    expect(init.signal).toBe(controller.signal)
    // A signal has no enumerable fields, so leaking it would send `signal: {}`
    // to the hub — an undeclared variable.
    expect(JSON.parse(init.body as string).variables).toEqual({ proposalId: '0x1' })
  })

  it('fetchVoterVote returns the account vote and forwards the signal', async () => {
    const fetchImpl = stubFetch({ data: { votes: [{ id: '0xv', choice: 2 }] } })
    const controller = new AbortController()

    const vote = await fetchVoterVote('https://hub.test/graphql', {
      proposalId: '0xp',
      voter: '0xabc',
      signal: controller.signal
    })

    expect(vote).toEqual({ id: '0xv', choice: 2 })
    const init = fetchImpl.mock.calls[0]![1] as RequestInit
    expect(init.signal).toBe(controller.signal)
    expect(JSON.parse(init.body as string).variables).toEqual({ proposalId: '0xp', voter: '0xabc' })
  })

  it('fetchVoterVote returns null when the account has not voted', async () => {
    stubFetch({ data: { votes: [] } })
    await expect(
      fetchVoterVote('https://hub.test/graphql', { proposalId: '0xp', voter: '0xabc' })
    ).resolves.toBeNull()
  })
})
