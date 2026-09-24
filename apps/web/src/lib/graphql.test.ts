import { describe, expect, it, vi } from 'vitest'

import {
  fetchProposal,
  fetchSpaceWithProposals,
  fetchSpaces,
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

  it('fetchProposal returns the proposal', async () => {
    stubFetch({ data: { proposal: { id: '0x1', title: 'T' } } })
    await expect(
      fetchProposal('https://hub.test/graphql', { proposalId: '0x1' })
    ).resolves.toEqual({ proposal: { id: '0x1', title: 'T' } })
  })
})
