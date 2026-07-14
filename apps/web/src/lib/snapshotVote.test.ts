import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import type { TypedDataPayload } from '../auth/kms'
import { buildVoteTypedData, castVote, resolveVoteSubmitUrl } from './snapshotVote'

const FROM_LOWER = '0x1111111111111111111111111111111111111111'
const SPACE = 'aastar.eth'
const PROPOSAL = '0xabc123'

/**
 * The Snapshot hub validates an incoming envelope by hashing `data.types` and
 * looking the digest up in its `hashedTypes.json` allowlist. These are the
 * allowlisted digests for the three vote variants (verified against
 * snapshot.js@0.14.20). If a change to our hand-copied type definitions moves
 * any of these hashes, the hub will reject every vote — so pin them.
 */
const ALLOWLISTED_TYPE_HASHES = {
  vote: 'fb8fa9816cd42974e7f1af671aa548c8c458553364ed809e45042f141de8c0d5',
  'vote-array': '5f95ed849bafb034c37e340dc06ad6fa6985d674714cb602a6bf11119ffba2a1',
  'vote-string': 'afc5911fd9722b3dc5e8b16a552997510644a52d2b229c3868fb1910b112416e'
}

function hashTypes(types: unknown): string {
  return createHash('sha256').update(JSON.stringify(types)).digest('hex')
}

function baseVote() {
  return { from: FROM_LOWER, space: SPACE, proposal: PROPOSAL, timestamp: 1_700_000_000 }
}

describe('Snapshot EIP-712 types match the hub allowlist', () => {
  it('single-choice / basic hash to "vote"', () => {
    for (const type of ['single-choice', 'basic'] as const) {
      const { types } = buildVoteTypedData({ ...baseVote(), type, choice: 1 })
      expect(hashTypes(types)).toBe(ALLOWLISTED_TYPE_HASHES.vote)
    }
  })

  it('approval / ranked-choice hash to "vote-array"', () => {
    for (const type of ['approval', 'ranked-choice'] as const) {
      const { types } = buildVoteTypedData({ ...baseVote(), type, choice: [1] })
      expect(hashTypes(types)).toBe(ALLOWLISTED_TYPE_HASHES['vote-array'])
    }
  })

  it('weighted / quadratic hash to "vote-string"', () => {
    for (const type of ['weighted', 'quadratic'] as const) {
      const { types } = buildVoteTypedData({ ...baseVote(), type, choice: { '1': 1 } })
      expect(hashTypes(types)).toBe(ALLOWLISTED_TYPE_HASHES['vote-string'])
    }
  })
})

describe('buildVoteTypedData', () => {
  it('builds the snapshot domain and a Vote primary type', () => {
    const payload = buildVoteTypedData({ ...baseVote(), type: 'single-choice', choice: 2 })

    expect(payload.domain).toEqual({ name: 'snapshot', version: '0.1.4' })
    expect(payload.primaryType).toBe('Vote')
  })

  it('omits EIP712Domain from types — the hub hashes types without it', () => {
    const payload = buildVoteTypedData({ ...baseVote(), type: 'single-choice', choice: 1 })

    expect(payload.types).not.toHaveProperty('EIP712Domain')
    expect(Object.keys(payload.types)).toEqual(['Vote'])
  })

  it('checksums `from` and applies snapshot.js field defaults', () => {
    const payload = buildVoteTypedData({ ...baseVote(), type: 'single-choice', choice: 1 })

    expect(payload.message).toEqual({
      from: '0x1111111111111111111111111111111111111111',
      space: SPACE,
      timestamp: 1_700_000_000,
      proposal: PROPOSAL,
      choice: 1,
      reason: '',
      app: '',
      metadata: '{}'
    })
  })

  it('JSON-encodes the choice for weighted votes', () => {
    const payload = buildVoteTypedData({
      ...baseVote(),
      type: 'weighted',
      choice: { '1': 2, '2': 1 }
    })

    expect(payload.message.choice).toBe('{"1":2,"2":1}')
  })

  it('leaves an array choice intact for approval votes', () => {
    const payload = buildVoteTypedData({ ...baseVote(), type: 'approval', choice: [1, 3] })

    expect(payload.message.choice).toEqual([1, 3])
  })

  it('drops `type` and `privacy` from the signed struct', () => {
    const payload = buildVoteTypedData({
      ...baseVote(),
      type: 'single-choice',
      choice: 1,
      privacy: ''
    })

    expect(payload.message).not.toHaveProperty('type')
    expect(payload.message).not.toHaveProperty('privacy')
  })

  it('stamps a timestamp when none is given', () => {
    const payload = buildVoteTypedData({
      from: FROM_LOWER,
      space: SPACE,
      proposal: PROPOSAL,
      type: 'single-choice',
      choice: 1
    })

    expect(payload.message.timestamp).toBeTypeOf('number')
  })
})

describe('resolveVoteSubmitUrl', () => {
  it('maps the public hubs to their sequencers, as snapshot.js does', () => {
    expect(resolveVoteSubmitUrl('https://testnet.hub.snapshot.org')).toBe(
      'https://testnet.seq.snapshot.org'
    )
    expect(resolveVoteSubmitUrl('https://hub.snapshot.org')).toBe('https://seq.snapshot.org')
  })

  it('ignores a trailing slash', () => {
    expect(resolveVoteSubmitUrl('https://testnet.hub.snapshot.org/')).toBe(
      'https://testnet.seq.snapshot.org'
    )
  })

  it('falls back to POST /api/msg for a self-hosted hub', () => {
    expect(resolveVoteSubmitUrl('https://hub.internal')).toBe('https://hub.internal/api/msg')
  })
})

describe('castVote', () => {
  it('signs the payload and POSTs the { address, sig, data } envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'receipt-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    const signTypedData = vi.fn().mockResolvedValue('0xsig')

    const receipt = await castVote({
      hubUrl: 'https://testnet.hub.snapshot.org',
      vote: { ...baseVote(), type: 'single-choice', choice: 1, app: 'myvote' },
      signTypedData,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(receipt).toEqual({ id: 'receipt-1' })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://testnet.seq.snapshot.org')

    const envelope = JSON.parse(init.body as string)
    expect(envelope.address).toBe('0x1111111111111111111111111111111111111111')
    expect(envelope.sig).toBe('0xsig')
    expect(Object.keys(envelope.data).sort()).toEqual(['domain', 'message', 'types'])
    expect(envelope.data.domain).toEqual({ name: 'snapshot', version: '0.1.4' })

    // What we signed is exactly what we sent.
    const [signed] = signTypedData.mock.calls[0] as [TypedDataPayload]
    expect(envelope.data.message).toEqual(signed.message)
    expect(envelope.data.types).toEqual(signed.types)
  })

  it('surfaces a hub rejection', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized', error_description: 'no voting power' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    )

    await expect(
      castVote({
        hubUrl: 'https://testnet.hub.snapshot.org',
        vote: { ...baseVote(), type: 'single-choice', choice: 1 },
        signTypedData: vi.fn().mockResolvedValue('0xsig'),
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toThrow(/no voting power/)
  })

  it('explains a timestamp rejection as clock skew, not an opaque hub error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_message', error_description: 'invalid timestamp' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    )

    const promise = castVote({
      hubUrl: 'https://testnet.hub.snapshot.org',
      vote: { ...baseVote(), type: 'single-choice', choice: 1 },
      signTypedData: vi.fn().mockResolvedValue('0xsig'),
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    // The sequencer rejects a timestamp too far from its own clock; the fix is on
    // the user's machine, so the message has to say so.
    await expect(promise).rejects.toThrow(/系统时间/)
    await expect(promise).rejects.toThrow(/invalid timestamp/)
  })

  it('does not POST when signing fails', async () => {
    const fetchImpl = vi.fn()

    await expect(
      castVote({
        hubUrl: 'https://testnet.hub.snapshot.org',
        vote: { ...baseVote(), type: 'single-choice', choice: 1 },
        signTypedData: vi.fn().mockRejectedValue(new Error('E-5 pending')),
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toThrow(/E-5 pending/)

    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
