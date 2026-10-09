import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  downloadCommunityExport, exportCommunity, EXPORT_LIMITS, isCommunityExportComplete
} from './communityExport'

const SX = '0x03C7431e14F7b759Aa44398AD7901e6053c197Bf'
const space = {
  id: 'a.eth', name: 'A', network: '1', admins: ['0xadmin'], moderators: [], members: [],
  proposalsCount: 1, strategies: [{ name: 'erc20-balance-of', network: '1', params: { address: '0xtoken' } }],
  treasuries: [{ name: 'Treasury', address: '0xtreasury', network: '10' }]
}
const proposal = { id: 'p1', created: 100, title: 'Full proposal', body: 'Body', choices: ['Yes'], votes: 1 }
const vote = { id: 'v1', created: 101, voter: '0xvoter', choice: { '1': 2 }, vp: 2, ipfs: 'cid' }
type Request = { query: string; variables: Record<string, unknown> }
function transport(handler: (request: Request) => unknown) {
  const fn = vi.fn(async (_url: string, init: RequestInit) =>
    new Response(JSON.stringify(handler(JSON.parse(String(init.body)))), { status: 200 })
  )
  vi.stubGlobal('fetch', fn)
  return fn
}
function normal({ query }: Request) {
  return { data: query.includes('space(id:') ? { space } : query.includes('proposals(')
    ? { proposals: [proposal] } : { votes: [vote] } }
}
async function run(options: Partial<Parameters<typeof exportCommunity>[0]> = {}) {
  const pending = exportCommunity({ spaceId: 'a.eth', endpoint: 'https://hub.test/graphql', ...options })
  await vi.runAllTimersAsync()
  return pending
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('community export', () => {
  it('exports raw classic metadata, roles, configured addresses and full records with provenance', async () => {
    const fn = transport(normal)
    const data = await run()
    expect(data.schemaVersion).toBe(1)
    expect(data.exportedAt).toMatch(/^2026-10-08T/)
    expect(data.source).toMatchObject({ endpoint: 'https://hub.test/graphql', protocol: 'snapshot', network: '1' })
    expect(data.community.metadata).toEqual(space)
    expect(data.community.management.admins).toEqual({ value: ['0xadmin'], availability: 'reported' })
    expect(data.community.management.moderators).toEqual({ value: [], availability: 'reported' })
    expect(data.community.contracts.space?.availability).toBe('not_applicable')
    expect(data.community.contracts.strategyConfiguration?.value).toEqual(space.strategies)
    expect(data.community.management.controller?.value).toBeNull()
    expect(data.history.records[0]?.proposal).toEqual(proposal)
    expect(data.history.records[0]?.votes.records).toEqual([vote])
    expect(isCommunityExportComplete(data)).toBe(true)
    expect(data.history.createdThrough).toBe('2026-10-08T00:00:00.000Z')
    expect(data.history.requests).toBe(3)
    for (const call of fn.mock.calls.slice(1)) {
      const body = JSON.parse(String(call[1].body))
      expect(body.variables.until).toBe(1791417600)
      expect(body.variables.state).toBeUndefined()
    }
  })

  it('distinguishes omitted admin fields from a reported empty list', async () => {
    transport((req) => req.query.includes('space(id:')
      ? { data: { space: { id: 'a.eth', proposalsCount: 0 } } } : { data: { proposals: [] } })
    const data = await run()
    expect(data.community.management.admins).toMatchObject({ value: null, availability: 'unavailable' })
    expect(data.source.network).toBeNull()
    expect(data.history.records).toEqual([])
    expect(isCommunityExportComplete(data)).toBe(true)
  })

  it('exports SX controller, contracts and precise numeric strings, with indexer-scoped history', async () => {
    const fn = transport(({ query, variables }) => {
      if (query.includes('space(id:')) return { data: { space: {
        id: SX, protocol: 'snapshot-x', _indexer: 'oeth', controller: '0xowner', proposal_count: 1,
        metadata: null, authenticators: ['0xauth'], strategies: ['0xstrategy'], strategies_params: [], validation_strategy: '0xvalidation'
      } } }
      expect(variables.indexer).toBe('oeth')
      if (query.includes('proposals(')) return { data: { proposals: [{
        id: SX + '/1', proposal_id: '1', created: 100, snapshot: '9007199254740993', vote_count: 1
      }] } }
      expect(variables.proposal).toBe('1')
      return { data: { votes: [{ id: 'sxv', created: 101, voter: { id: '0xvoter' }, vp: '12345678901234567890', choice: 1, tx: '0xtx' }] } }
    })
    const data = await run({ spaceId: SX, endpoint: 'https://sx.test' })
    expect(data.community.management.controller?.value).toBe('0xowner')
    expect(data.community.management.admins?.availability).toBe('unavailable')
    expect(data.community.contracts.space?.value).toBe(SX)
    expect(data.community.contracts.treasuries?.availability).toBe('unavailable')
    expect(data.history.records[0]?.proposal.snapshot).toBe('9007199254740993')
    expect(data.history.records[0]?.votes.records[0]?.vp).toBe('12345678901234567890')
    expect(data.source.indexer).toBe('oeth')
    expect(data.source.network).toBe('optimism')
    expect(isCommunityExportComplete(data)).toBe(true)
    expect(fn.mock.calls[2]?.[1].body).toContain('voter { id }')
  })

  it('crosses the Hub offset ceiling using boundary timestamps without losing ties or exact pages', async () => {
    const rows = Array.from({ length: 6500 }, (_, i) => ({ id: 'v' + i, created: Math.floor(i / 2) + 101 }))
    const fn = transport(({ query, variables }) => {
      if (query.includes('space(id:')) return { data: { space } }
      if (query.includes('proposals(')) return { data: { proposals: [{ ...proposal, votes: rows.length }] } }
      const matching = rows.filter((r) => r.created >= Number(variables.from))
      return { data: { votes: matching.slice(Number(variables.skip), Number(variables.skip) + Number(variables.first)) } }
    })
    const data = await run()
    expect(data.history.records[0]?.votes.records).toEqual(rows)
    expect(isCommunityExportComplete(data)).toBe(true)
    const skips = fn.mock.calls.slice(2).map((c) => JSON.parse(String(c[1].body)).variables.skip)
    expect(Math.max(...skips)).toBe(2)
  })

  it('stops at the timestamp tie ceiling and explicitly marks votes partial', async () => {
    transport(({ query, variables }) => {
      if (query.includes('space(id:')) return { data: { space } }
      if (query.includes('proposals(')) return { data: { proposals: [{ ...proposal, votes: 7000 }] } }
      return { data: { votes: Array.from({ length: 1000 }, (_, i) => ({ id: 'v' + (Number(variables.skip) + i), created: 101 })) } }
    })
    const data = await run()
    expect(data.history.records[0]?.votes.scope).toMatchObject({ status: 'partial', exported: 6000 })
    expect(data.history.records[0]?.votes.scope.reasons).toContain('timestamp_tie_limit')
    expect(isCommunityExportComplete(data)).toBe(false)
  })

  it('paginates proposal history independently of vote history', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ id: 'p' + i, created: i + 1, votes: 0 }))
    const fn = transport(({ query, variables }) => {
      if (query.includes('space(id:')) return { data: { space: { ...space, proposalsCount: 1001 } } }
      if (query.includes('proposals(')) {
        const matching = rows.filter((r) => r.created >= Number(variables.from))
        return { data: { proposals: matching.slice(Number(variables.skip), Number(variables.skip) + Number(variables.first)) } }
      }
      return { data: { votes: [] } }
    })
    const data = await run()
    expect(data.history.proposals).toMatchObject({ status: 'complete', exported: 1001 })
    expect(data.history.records).toHaveLength(1001)
    expect(data.history.requests).toBe(EXPORT_LIMITS.maxRequests)
    expect(data.history.records[data.history.records.length - 1]?.votes.scope.reasons).toContain('request_limit')
    expect(fn).toHaveBeenCalledTimes(EXPORT_LIMITS.maxRequests)
    expect(isCommunityExportComplete(data)).toBe(false)
  })

  it('bounds total history records and leaves remaining vote scopes explicit', async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ id: 'p' + i, created: i + 1, votes: 1000 }))
    const fn = transport(({ query, variables }) => {
      if (query.includes('space(id:')) return { data: { space: { ...space, proposalsCount: rows.length } } }
      if (query.includes('proposals(')) return { data: { proposals: rows } }
      const from = Number(variables.from)
      const skip = Number(variables.skip)
      const first = Number(variables.first)
      const matching = Array.from({ length: 1000 }, (_, i) => ({ id: String(variables.proposal) + '-v' + i, created: 200 + i }))
        .filter((r) => r.created >= from)
      return { data: { votes: matching.slice(skip, skip + first) } }
    })
    const data = await run()
    const exported = data.history.records.reduce((sum, r) => sum + r.votes.records.length, 0) + rows.length
    expect(exported).toBe(EXPORT_LIMITS.maxRecords)
    expect(data.history.records[data.history.records.length - 1]?.votes.scope.reasons).toContain('record_limit')
    expect(fn.mock.calls.length).toBeLessThan(EXPORT_LIMITS.maxRequests)
    expect(isCommunityExportComplete(data)).toBe(false)
  })

  it('uses the canonical API space identifier when input casing differs', async () => {
    transport(normal)
    const data = await run({ spaceId: 'A.ETH' })
    expect(data.community.metadata.id).toBe('a.eth')
  })

  it('labels count mismatches rather than claiming a capped or changing response is complete', async () => {
    transport((req) => req.query.includes('proposals(')
      ? { data: { proposals: [{ ...proposal, votes: 10 }] } } : normal(req))
    const data = await run()
    expect(data.history.records[0]?.votes.scope).toMatchObject({ status: 'partial', expected: 10, reasons: ['count_mismatch'] })
  })

  it('deduplicates a repeated page and stops when pagination makes no progress', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: 'v' + i, created: 101 }))
    const fn = transport((req) => req.query.includes('votes(') ? { data: { votes: rows } } : normal(req))
    const data = await run()
    expect(data.history.records[0]?.votes.records).toHaveLength(1000)
    expect(data.history.records[0]?.votes.scope.reasons).toContain('pagination_no_progress')
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('rejects unordered pages and labels the history unavailable', async () => {
    transport((req) => req.query.includes('votes(')
      ? { data: { votes: [{ ...vote, created: 102 }, { ...vote, id: 'v2', created: 101 }] } } : normal(req))
    const data = await run()
    expect(data.history.records[0]?.votes.scope.status).toBe('unavailable')
  })

  it('preserves proposal history if votes fail and avoids repeating rejected upstream queries', async () => {
    const fn = transport((req) => req.query.includes('proposals(')
      ? { data: { proposals: [proposal, { ...proposal, id: 'p2' }] } }
      : req.query.includes('votes(') ? { data: { votes: [vote] }, errors: [{ message: 'Unsupported vote field' }] } : normal(req))
    const data = await run()
    expect(data.history.records).toHaveLength(2)
    expect(data.history.records[0]?.votes.scope).toMatchObject({ status: 'unavailable', reasons: ['upstream_error', 'count_mismatch'] })
    expect(data.history.records[1]?.votes.scope.reasons).toContain('upstream_error_not_retried')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('retains downloaded vote pages and marks them partial when the next page fails', async () => {
    let calls = 0
    transport((req) => {
      if (!req.query.includes('votes(')) return normal(req)
      if (calls++) return { errors: [{ message: 'rate limited' }] }
      return { data: { votes: Array.from({ length: 1000 }, (_, i) => ({ id: 'v' + i, created: i + 101 })) } }
    })
    const data = await run()
    expect(data.history.records[0]?.votes.scope.status).toBe('partial')
    expect(data.history.records[0]?.votes.records).toHaveLength(1000)
  })

  it('does not export fabricated demo metadata when the API has no space', async () => {
    transport(() => ({ data: { space: null } }))
    const pending = expect(exportCommunity({ spaceId: 'a.eth', endpoint: 'https://hub.test' })).rejects.toThrow('metadata unavailable')
    await vi.runAllTimersAsync()
    await pending
  })

  it('honors cancellation while pacing and makes no further requests', async () => {
    const controller = new AbortController()
    const fn = transport(normal)
    const pending = exportCommunity({ spaceId: 'a.eth', endpoint: 'https://hub.test', signal: controller.signal })
    const assertion = expect(pending).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(1)
    controller.abort()
    await vi.runAllTimersAsync()
    await assertion
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('times out a hanging metadata request and passes cancellation to fetch', async () => {
    const fn = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fn)
    const assertion = expect(exportCommunity({ spaceId: 'a.eth', endpoint: 'https://hub.test' })).rejects.toThrow('Aborted')
    await vi.runAllTimersAsync()
    await assertion
    expect(fn.mock.calls[0]?.[1].signal?.aborted).toBe(true)
  })

  it('downloads parseable portable JSON with a safe filename and cleans up the object URL', async () => {
    transport(normal)
    const data = await run()
    data.community.metadata.id = '../bad/space:name'
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    let filename = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      filename = this.download
      expect(this.href).toBe('blob:export')
      expect(this.isConnected).toBe(true)
    })
    downloadCommunityExport(data)
    const blob = create.mock.calls[0]?.[0] as Blob
    expect(blob.type).toBe('application/json;charset=utf-8')
    expect(JSON.parse(await blob.text())).toEqual(data)
    expect(filename).toMatch(/^myvote-\.\._bad_space_name-.*\.json$/)
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revoke).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(revoke).toHaveBeenCalledWith('blob:export')
  })
})
