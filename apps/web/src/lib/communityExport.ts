import { graphqlRequest } from './graphql'
import { sxNetworkFromIndexer } from './sx/api'
import { protocolForSpaceId } from './voteRouting'

// Export queries are independent of the detail page's filters and lookahead.
export const EXPORT_SPACE_QUERY = `query ExportSpace($id: String!) {
  space(id: $id) {
    id name about network symbol avatar website created admins moderators members
    proposalsCount strategies { name network params } treasuries { name address network }
  }
}`
export const EXPORT_SX_SPACE_QUERY = `query ExportSpace($id: String!) {
  space(id: $id) {
    id protocol _indexer controller created proposal_count vote_count
    metadata { name about avatar external_url treasuries }
    authenticators validation_strategy strategies_indices strategies strategies_params
  }
}`
export const EXPORT_PROPOSALS_QUERY = `query ExportProposals(
  $space: String!, $first: Int!, $skip: Int!, $from: Int!, $until: Int!
) {
  proposals(first: $first, skip: $skip, orderBy: "created", orderDirection: asc,
    where: { space: $space, created_gte: $from, created_lte: $until }) {
    id ipfs title body choices type author created start end snapshot state network
    votes scores scores_total scores_state privacy strategies { name network params }
  }
}`
export const EXPORT_VOTES_QUERY = `query ExportVotes(
  $space: String!, $proposal: String!, $first: Int!, $skip: Int!, $from: Int!, $until: Int!
) {
  votes(first: $first, skip: $skip, orderBy: "created", orderDirection: asc,
    where: { space: $space, proposal: $proposal, created_gte: $from, created_lte: $until }) {
    id ipfs voter created choice vp vp_by_strategy vp_state reason metadata
  }
}`
export const EXPORT_SX_PROPOSALS_QUERY = `query ExportProposals(
  $indexer: String!, $space: String!, $first: Int!, $skip: Int!, $from: Int!, $until: Int!
) {
  proposals(indexer: $indexer, first: $first, skip: $skip, orderBy: created, orderDirection: asc,
    where: { space: $space, created_gte: $from, created_lte: $until }) {
    id proposal_id type author { id } created metadata { title body choices }
    snapshot start min_end max_end state vote_count tx execution_strategy treasuries
    scores_1 scores_2 scores_3 scores_total strategies_indices strategies strategies_params
  }
}`
export const EXPORT_SX_VOTES_QUERY = `query ExportVotes(
  $indexer: String!, $space: String!, $proposal: String!, $first: Int!, $skip: Int!, $from: Int!, $until: Int!
) {
  votes(indexer: $indexer, first: $first, skip: $skip, orderBy: created, orderDirection: asc,
    where: { space: $space, proposal: $proposal, created_gte: $from, created_lte: $until }) {
    id voter { id } created choice vp vp_parsed tx metadata { reason }
  }
}`

/** Public bounds are recorded in every export, including partial ones. */
export const EXPORT_LIMITS = {
  pageSize: 1000,
  maxRequests: 300,
  maxRecords: 100000,
  maxTieSkip: 5000,
  requestIntervalMs: 650,
  requestTimeoutMs: 20000
} as const

type RecordData = Record<string, unknown>
type HistoryRow = RecordData & { id: string; created: number }
type Scope = {
  status: 'complete' | 'partial' | 'unavailable'
  exported: number
  expected: number | null
  reasons: string[]
}
type ExportField = {
  value: unknown
  availability: 'reported' | 'unavailable' | 'not_applicable'
  reason?: string
}
export type CommunityExport = {
  schemaVersion: 1
  exportedAt: string
  source: { application: 'MyVote'; endpoint: string; protocol: string; network: unknown; indexer: unknown }
  community: { metadata: RecordData; management: Record<string, ExportField>; contracts: Record<string, ExportField> }
  history: {
    scope: string
    createdThrough: string
    consistency: string
    limits: typeof EXPORT_LIMITS
    requests: number
    proposals: Scope
    records: { proposal: HistoryRow; votes: { scope: Scope; records: HistoryRow[] } }[]
  }
}
export type ExportProgress = { proposals: number; votes: number; requests: number }

function reported(value: unknown): ExportField {
  return value === undefined || value === null
    ? { value: null, availability: 'unavailable', reason: 'not_returned_by_api' }
    : { value, availability: 'reported' }
}
function unavailable(reason: string): ExportField {
  return { value: null, availability: 'unavailable', reason }
}
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}
function checkAbort(signal?: AbortSignal) {
  signal?.throwIfAborted()
}
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  checkAbort(signal)
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** Strict GraphQL reads: partial data with errors must never masquerade as complete history. */
export async function exportCommunity(options: {
  spaceId: string
  endpoint: string
  signal?: AbortSignal
  onProgress?: (progress: ExportProgress) => void
}): Promise<CommunityExport> {
  const { spaceId, endpoint, signal, onProgress } = options
  const sx = protocolForSpaceId(spaceId) === 'snapshot-x'
  const started = new Date()
  const until = Math.floor(started.getTime() / 1000)
  let requests = 0
  let totalRecords = 0
  let proposalCount = 0
  let voteCount = 0
  let lastRequestAt = 0
  const progress = () => onProgress?.({ proposals: proposalCount, votes: voteCount, requests })
  async function request<T>(query: string, variables: RecordData): Promise<T> {
    checkAbort(signal)
    if (requests >= EXPORT_LIMITS.maxRequests) throw new Error('request_limit')
    await pause(Math.max(0, EXPORT_LIMITS.requestIntervalMs - (Date.now() - lastRequestAt)), signal)
    checkAbort(signal)
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(), EXPORT_LIMITS.requestTimeoutMs)
    lastRequestAt = Date.now()
    requests++
    progress()
    try {
      return await graphqlRequest<T>(endpoint, query, variables, controller.signal)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
  const data = await request<{ space: RecordData | null }>(
    sx ? EXPORT_SX_SPACE_QUERY : EXPORT_SPACE_QUERY, { id: spaceId }
  )
  checkAbort(signal)
  if (!data.space || typeof data.space.id !== 'string' || data.space.id.toLowerCase() !== spaceId.toLowerCase()) throw new Error('Space metadata unavailable')
  const metadata = data.space
  if (sx && typeof metadata._indexer !== 'string') throw new Error('Space network unavailable')
  const variables: RecordData = { space: metadata.id, until, ...(sx ? { indexer: metadata._indexer } : {}) }

  async function collect(query: string, key: 'proposals' | 'votes', extra: RecordData, expected: number | null) {
    const records: HistoryRow[] = []
    const ids = new Set<string>()
    const reasons: string[] = []
    let from = 0
    let skip = 0
    let exhausted = false
    while (!exhausted) {
      checkAbort(signal)
      const limit = requests >= EXPORT_LIMITS.maxRequests ? 'request_limit'
        : totalRecords >= EXPORT_LIMITS.maxRecords ? 'record_limit'
          : skip > EXPORT_LIMITS.maxTieSkip ? 'timestamp_tie_limit' : null
      if (limit) { reasons.push(limit); break }
      const first = Math.min(EXPORT_LIMITS.pageSize, EXPORT_LIMITS.maxRecords - totalRecords)
      let page: HistoryRow[]
      try {
        const result = await request<Record<string, HistoryRow[]>>(query, { ...variables, ...extra, first, skip, from })
        page = result[key]!
        if (!Array.isArray(page) || page.length > first || page.some((row) =>
          !row || typeof row.id !== 'string' || !Number.isSafeInteger(row.created) ||
          row.created < from || row.created > until
        ) || page.some((row, i) => i > 0 && row.created < page[i - 1]!.created)) {
          throw new Error('Invalid history page')
        }
      } catch {
        checkAbort(signal)
        reasons.push('upstream_error')
        break
      }
      let added = 0
      for (const row of page) {
        if (ids.has(row.id)) {
          if (!reasons.includes('duplicate_records')) reasons.push('duplicate_records')
          continue
        }
        ids.add(row.id)
        records.push(row)
        totalRecords++
        added++
        if (key === 'proposals') proposalCount++
        else voteCount++
      }
      progress()
      exhausted = page.length < first
      if (!exhausted) {
        if (!added) { reasons.push('pagination_no_progress'); break }
        const lastCreated = page[page.length - 1]!.created
        // Restart at the boundary timestamp, offsetting only records tied there.
        // This crosses Hub's deep-offset limit without dropping timestamp ties.
        skip = (lastCreated === from ? skip : 0) + page.filter((row) => row.created === lastCreated).length
        from = lastCreated
      }
    }
    if (expected !== null && records.length !== expected) reasons.push('count_mismatch')
    const scope: Scope = {
      status: reasons.length ? (records.length ? 'partial' : 'unavailable') : 'complete',
      exported: records.length, expected, reasons
    }
    return { scope, records }
  }

  const proposals = await collect(sx ? EXPORT_SX_PROPOSALS_QUERY : EXPORT_PROPOSALS_QUERY,
    'proposals', {}, count(metadata[sx ? 'proposal_count' : 'proposalsCount']))
  const records: CommunityExport['history']['records'] = []
  let votesUnavailable = false
  for (const proposal of proposals.records) {
    checkAbort(signal)
    const expected = count(proposal[sx ? 'vote_count' : 'votes'])
    // Do not hammer a backend that rejected the vote query. Remaining proposals
    // still carry explicit unavailable vote scope, rather than false empty history.
    const votes = votesUnavailable
      ? { scope: { status: 'unavailable' as const, exported: 0, expected, reasons: ['upstream_error_not_retried'] }, records: [] }
      : await collect(sx ? EXPORT_SX_VOTES_QUERY : EXPORT_VOTES_QUERY, 'votes',
          { proposal: sx ? proposal.proposal_id : proposal.id }, expected)
    if (votes.scope.reasons.includes('upstream_error')) votesUnavailable = true
    records.push({ proposal, votes })
  }
  const contracts: Record<string, ExportField> = sx ? {
    space: reported(metadata.id), authenticators: reported(metadata.authenticators),
    validationStrategy: reported(metadata.validation_strategy), votingStrategies: reported(metadata.strategies),
    strategyParameters: reported(metadata.strategies_params),
    treasuries: reported((metadata.metadata as RecordData | null)?.treasuries)
  } : {
    space: { value: null, availability: 'not_applicable', reason: 'classic_offchain_space' },
    // Preserve strategy configuration without guessing which arbitrary params
    // are contract addresses, or whether a reported treasury is a contract.
    strategyConfiguration: reported(metadata.strategies), treasuries: reported(metadata.treasuries),
    execution: unavailable('not_exposed_by_hub_space_api')
  }
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    source: {
      application: 'MyVote', endpoint, protocol: sx ? String(metadata.protocol ?? 'snapshot-x') : 'snapshot',
      network: sx ? sxNetworkFromIndexer(String(metadata._indexer)) : metadata.network ?? null, indexer: sx ? metadata._indexer : null
    },
    community: {
      metadata,
      management: sx
        ? { controller: reported(metadata.controller), admins: unavailable('not_exposed_by_sx_api'), moderators: unavailable('not_exposed_by_sx_api') }
        : { admins: reported(metadata.admins), moderators: reported(metadata.moderators), members: reported(metadata.members), controller: unavailable('not_exposed_by_hub_space_api') },
      contracts
    },
    history: {
      scope: 'All API-visible proposals (all states) and their current indexed vote records; excludes deleted records and replaced vote versions.',
      createdThrough: started.toISOString(),
      consistency: 'Live API reads, not an atomic snapshot. Counts and pagination can change during export; scope reports detected gaps. SX scores expose only three choices. Null metadata or hidden choices are preserved as returned.',
      limits: EXPORT_LIMITS, requests, proposals: proposals.scope, records
    }
  }
}

export function isCommunityExportComplete(data: CommunityExport): boolean {
  return data.history.proposals.status === 'complete' &&
    data.history.records.every((record) => record.votes.scope.status === 'complete')
}

export function downloadCommunityExport(data: CommunityExport): void {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const id = String(data.community.metadata.id).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  link.href = url
  link.download = `myvote-${id}-${data.exportedAt.replace(/[:.]/g, '-')}.json`
  document.body.append(link)
  try { link.click() } finally {
    link.remove()
    // Give the browser time to start the download before releasing the blob.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
