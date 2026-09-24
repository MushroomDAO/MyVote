import { describe, expect, it, vi } from 'vitest'

import type { TypedDataPayload } from '../auth/kms'
import type { VoteInput } from './snapshotVote'
import { createSnapshotOffchainBackend } from './voteBackend'

const HUB = 'https://testnet.hub.snapshot.org'
const FROM = '0x1111111111111111111111111111111111111111'

function vote(): VoteInput {
  return {
    from: FROM,
    space: 'aastar.eth',
    proposal: '0xabc123',
    type: 'single-choice',
    choice: 1,
    timestamp: 1_700_000_000
  }
}

function okFetch(payload: unknown = { id: 'receipt-1' }) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  )
}

describe('createSnapshotOffchainBackend', () => {
  it('identifies itself as the off-chain backend', () => {
    const backend = createSnapshotOffchainBackend(HUB)
    expect(backend.id).toBe('snapshot-offchain')
    expect(backend.name).toMatch(/off-chain/i)
  })

  it('builds the envelope, signs it, and submits to the sequencer', async () => {
    const fetchImpl = okFetch()
    const signTypedData = vi.fn().mockResolvedValue('0xsig')

    const receipt = await createSnapshotOffchainBackend(HUB).castVote({
      vote: vote(),
      signTypedData,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(receipt).toEqual({ id: 'receipt-1' })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://testnet.seq.snapshot.org')

    const envelope = JSON.parse(init.body as string)
    expect(envelope.address).toBe(FROM)
    expect(envelope.sig).toBe('0xsig')

    // What the backend asked us to sign is exactly what it submitted.
    const [signed] = signTypedData.mock.calls[0] as [TypedDataPayload]
    expect(envelope.data.message).toEqual(signed.message)
    expect(envelope.data.types).toEqual(signed.types)
  })

  it('normalises a trailing slash on the hub URL', async () => {
    const fetchImpl = okFetch({})
    await createSnapshotOffchainBackend(HUB + '/').castVote({
      vote: vote(),
      signTypedData: vi.fn().mockResolvedValue('0xsig'),
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://testnet.seq.snapshot.org')
  })

  it('does not submit when signing fails', async () => {
    const fetchImpl = vi.fn()

    await expect(
      createSnapshotOffchainBackend(HUB).castVote({
        vote: vote(),
        signTypedData: vi.fn().mockRejectedValue(new Error('E-5 pending')),
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toThrow(/E-5 pending/)

    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
