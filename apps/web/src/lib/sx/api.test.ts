import { describe, expect, it, vi } from 'vitest'

import { SX_API_DEFAULT } from './types'
import {
  buildSxVoteRequest,
  fetchSxProposal,
  fetchSxProposals,
  fetchSxSpace,
  SX_PROPOSAL_QUERY,
  SX_PROPOSALS_QUERY,
  SX_SPACE_QUERY,
  sxGraphqlRequest,
  toSxProposal,
  toSxSpace,
  zipStrategies,
  type SxProposalWire,
  type SxSpaceWire
} from './api'

// Captured from the live indexer (Optimism, _indexer "oeth").
const SPACE_WIRE: SxSpaceWire = {
  id: '0x03C7431e14F7b759Aa44398AD7901e6053c197Bf',
  protocol: 'snapshot-x',
  metadata: { name: 'Ryu0x167 Space Command', about: null },
  authenticators: ['0x5f9B7D78c9a37a439D78f801E0E339C6E711e260'],
  vp_decimals: 0,
  proposal_count: 12,
  _indexer: 'oeth',
  strategies_indices: [0],
  strategies: ['0x34f0AfFF5A739bBf3E285615F50e40ddAaf2A829'],
  strategies_params: ['0x3d998d116d221187f395fc08625b1d5b3bc3ee17f45cc11d869b7165665f391a']
}

const PROPOSAL_WIRE: SxProposalWire = {
  id: '0x03C7431e14F7b759Aa44398AD7901e6053c197Bf/12',
  proposal_id: '12',
  type: 'basic',
  metadata: { title: 'Active 1', body: '', choices: ['For', 'Against', 'Abstain'] },
  state: 'closed',
  snapshot: '125246602',
  start: '1726091981',
  min_end: '1726092101',
  max_end: '1726095581',
  scores_1_parsed: 3,
  scores_2_parsed: 0,
  scores_3_parsed: 0,
  scores_total_parsed: 3,
  vote_count: 3,
  _indexer: 'oeth',
  strategies_indices: [0],
  strategies: ['0x34f0AfFF5A739bBf3E285615F50e40ddAaf2A829'],
  strategies_params: ['0x3d998d116d221187f395fc08625b1d5b3bc3ee17f45cc11d869b7165665f391a'],
  space: {
    id: '0x03C7431e14F7b759Aa44398AD7901e6053c197Bf',
    metadata: { name: 'Ryu0x167 Space Command' },
    authenticators: ['0x5f9B7D78c9a37a439D78f801E0E339C6E711e260'],
    strategies_indices: [0],
    strategies: ['0x34f0AfFF5A739bBf3E285615F50e40ddAaf2A829'],
    strategies_params: ['0x3d998d116d221187f395fc08625b1d5b3bc3ee17f45cc11d869b7165665f391a']
  }
}

describe('zipStrategies', () => {
  it('zips parallel arrays and defaults missing params to 0x', () => {
    expect(zipStrategies([0, 1], ['0xa'], [])).toEqual([
      { index: 0, address: '0xa', params: '0x' },
      { index: 1, address: '', params: '0x' }
    ])
  })
})

describe('mappers', () => {
  it('maps a space wire record', () => {
    const space = toSxSpace(SPACE_WIRE)
    expect(space.name).toBe('Ryu0x167 Space Command')
    expect(space.authenticators[0]).toBe('0x5f9B7D78c9a37a439D78f801E0E339C6E711e260')
    expect(space.strategies).toHaveLength(1)
    expect(space.strategies[0]!.index).toBe(0)
  })

  it('maps a proposal wire record and parses numeric strings', () => {
    const proposal = toSxProposal(PROPOSAL_WIRE)
    expect(proposal.proposalId).toBe(12)
    expect(proposal.choices).toEqual(['For', 'Against', 'Abstain'])
    expect(proposal.snapshot).toBe(125246602)
    expect(proposal.start).toBe(1726091981)
    expect(proposal.end).toBe(1726092101)
    expect(proposal.space?.authenticators).toHaveLength(1)
    expect(proposal.space?.name).toBe('Ryu0x167 Space Command')
    // Results render from the parsed per-choice scores.
    expect(proposal.type).toBe('basic')
    expect(proposal.scores).toEqual([3, 0, 0])
    expect(proposal.scoresTotal).toBe(3)
  })
})

describe('buildSxVoteRequest', () => {
  it('builds an sx.js Vote from indexed data', () => {
    expect(
      buildSxVoteRequest({
        spaceId: SPACE_WIRE.id,
        authenticators: SPACE_WIRE.authenticators,
        strategies: toSxSpace(SPACE_WIRE).strategies,
        proposalId: 12,
        choice: 1
      })
    ).toEqual({
      space: SPACE_WIRE.id,
      authenticator: '0x5f9B7D78c9a37a439D78f801E0E339C6E711e260',
      strategies: toSxSpace(SPACE_WIRE).strategies,
      proposal: 12,
      choice: 1,
      metadataUri: ''
    })
  })

  it('throws when the space has no authenticator', () => {
    expect(() =>
      buildSxVoteRequest({ spaceId: '0x1', authenticators: [], strategies: [], proposalId: 1, choice: 1 })
    ).toThrow(/no authenticator/)
  })
})

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

describe('sxGraphqlRequest', () => {
  it('posts the query and returns data', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }))
    const data = await sxGraphqlRequest<{ ok: boolean }>(
      'https://api.example',
      'query { ok }',
      { a: 1 },
      fetchImpl as unknown as typeof fetch
    )
    expect(data).toEqual({ ok: true })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example')
    expect(JSON.parse(init.body as string)).toEqual({ query: 'query { ok }', variables: { a: 1 } })
  })

  it('surfaces GraphQL errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ errors: [{ message: 'boom' }] }))
    await expect(
      sxGraphqlRequest('https://api.example', 'q', {}, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/boom/)
  })

  it('tolerates partial data returned alongside per-row errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: { spaces: [{ id: 'a' }] },
        errors: [{ message: 'row 7 metadata is null' }]
      })
    )

    const data = await sxGraphqlRequest<{ spaces: unknown[] }>(
      'https://api.example',
      'q',
      {},
      fetchImpl as unknown as typeof fetch
    )
    expect(data.spaces).toHaveLength(1)
  })

  it('surfaces a non-JSON response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>', { status: 502 }))
    await expect(
      sxGraphqlRequest('https://api.example', 'q', {}, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/non-JSON/)
  })
})

describe('fetchers', () => {
  it('fetchSxSpace targets the space query and maps the result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { space: SPACE_WIRE } }))
    const space = await fetchSxSpace('https://api.example', SPACE_WIRE.id, fetchImpl as unknown as typeof fetch)
    expect(space?.name).toBe('Ryu0x167 Space Command')
    expect(JSON.parse((fetchImpl.mock.lastCall![1] as RequestInit).body as string).query).toBe(SX_SPACE_QUERY)
  })

  it('fetchSxProposals passes space + pagination', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { proposals: [PROPOSAL_WIRE] } }))
    const proposals = await fetchSxProposals(
      'https://api.example',
      SPACE_WIRE.id,
      { first: 5, skip: 10 },
      fetchImpl as unknown as typeof fetch
    )
    expect(proposals[0]!.proposalId).toBe(12)
    const body = JSON.parse((fetchImpl.mock.lastCall![1] as RequestInit).body as string)
    expect(body.query).toBe(SX_PROPOSALS_QUERY)
    expect(body.variables).toEqual({ space: SPACE_WIRE.id, first: 5, skip: 10 })
  })

  it('fetchSxProposal targets the single-proposal query', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { proposal: PROPOSAL_WIRE } }))
    const proposal = await fetchSxProposal(
      'https://api.example',
      PROPOSAL_WIRE.id,
      fetchImpl as unknown as typeof fetch
    )
    expect(proposal?.space?.id).toBe(SPACE_WIRE.id)
    expect(JSON.parse((fetchImpl.mock.lastCall![1] as RequestInit).body as string).query).toBe(SX_PROPOSAL_QUERY)
  })

  it('defaults the endpoint to the official indexer', () => {
    expect(SX_API_DEFAULT).toBe('https://api.snapshot.box')
  })
})

// Opt-in live check against the real indexer: `SX_LIVE=1 vitest run src/lib/sx/api.test.ts`.
// Skipped by default so the normal suite stays offline.
const LIVE_SPACE = '0x03C7431e14F7b759Aa44398AD7901e6053c197Bf'
describe.skipIf(!process.env.SX_LIVE)('live indexer (SX_LIVE=1)', () => {
  it(
    'reads a real Optimism SX space, its proposals, and one proposal with its space',
    async () => {
      const space = await fetchSxSpace(SX_API_DEFAULT, LIVE_SPACE)
      expect(space?.authenticators.length).toBeGreaterThan(0)

      const proposals = await fetchSxProposals(SX_API_DEFAULT, LIVE_SPACE, { first: 1 })
      expect(proposals.length).toBe(1)

      const proposal = await fetchSxProposal(SX_API_DEFAULT, proposals[0]!.id)
      expect(proposal?.space?.authenticators.length).toBeGreaterThan(0)
      expect(proposal!.proposalId).toBeGreaterThan(0)

      // And it all maps into a submittable sx.js Vote request.
      const request = buildSxVoteRequest({
        spaceId: space!.id,
        authenticators: space!.authenticators,
        strategies: space!.strategies,
        proposalId: proposal!.proposalId,
        choice: 1
      })
      expect(request.authenticator).toMatch(/^0x[0-9a-fA-F]{40}$/)
    },
    30000
  )
})
