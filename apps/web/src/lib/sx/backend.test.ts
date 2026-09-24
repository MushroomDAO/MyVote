import { describe, expect, it, vi } from 'vitest'

import {
  createEthersCompatSigner,
  createSnapshotXEvmBackend,
  primaryTypeOf,
  sxNetworkLabel,
  SX_MANA_URL,
  SX_WHITELIST_URL,
  type SxClient,
  type SxVoteRequest
} from './backend'

describe('sxNetworkLabel', () => {
  it('maps network ids to labels, and null to null', () => {
    expect(sxNetworkLabel('optimism')).toBe('Optimism')
    expect(sxNetworkLabel('base')).toBe('Base')
    expect(sxNetworkLabel(null)).toBeNull()
    expect(sxNetworkLabel(undefined)).toBeNull()
  })
})

describe('primaryTypeOf', () => {
  it('returns the first non-domain struct', () => {
    expect(primaryTypeOf({ EIP712Domain: [], Vote: [] })).toBe('Vote')
    expect(primaryTypeOf({ Vote: [], Proposal: [] })).toBe('Vote')
  })

  it('falls back to Vote', () => {
    expect(primaryTypeOf({})).toBe('Vote')
  })
})

describe('createEthersCompatSigner', () => {
  it('re-shapes an ethers call into our typed-data payload', async () => {
    const sign = vi.fn().mockResolvedValue('0xsig')
    const signer = createEthersCompatSigner('0xabc', sign)

    expect(await signer.getAddress()).toBe('0xabc')
    const sig = await signer._signTypedData(
      { name: 'snapshot-x' },
      { EIP712Domain: [], Vote: [] },
      { choice: 1 }
    )

    expect(sig).toBe('0xsig')
    expect(sign).toHaveBeenCalledWith({
      domain: { name: 'snapshot-x' },
      types: { EIP712Domain: [], Vote: [] },
      primaryType: 'Vote',
      message: { choice: 1 }
    })
  })

  it('exposes both ethers spellings', async () => {
    const sign = vi.fn().mockResolvedValue('0xsig')
    const signer = createEthersCompatSigner('0xabc', sign)

    await signer.signTypedData({}, { Vote: [] }, {})
    await signer._signTypedData({}, { Vote: [] }, {})

    expect(sign).toHaveBeenCalledTimes(2)
  })
})

function request(): SxVoteRequest {
  return {
    space: '0x012b261effbf548f2b9a495d50b81a8a7c1dd941',
    authenticator: '0xba06e6ccb877c332181a6867c05c8b746a21aed1',
    strategies: [{ index: 0, address: '0xc1245c5dca7885c73e32294140f1e5d30688c202', params: '0x' }],
    proposal: 7,
    choice: 1,
    metadataUri: ''
  }
}

const PROVIDER = { __fakeProvider: true }

describe('createSnapshotXEvmBackend', () => {
  it('signs and submits through the injected sx client', async () => {
    const vote = vi.fn().mockResolvedValue({ id: 'sx-receipt' })
    const client = { vote } as unknown as SxClient
    const loadSxClient = vi.fn().mockResolvedValue(client)
    const backend = createSnapshotXEvmBackend({
      config: { network: 'optimism', provider: PROVIDER },
      loadSxClient
    })
    const signer = createEthersCompatSigner('0xabc', vi.fn().mockResolvedValue('0xsig'))

    const receipt = await backend.castVote(request(), signer)

    expect(receipt).toEqual({ id: 'sx-receipt' })
    expect(backend.id).toBe('snapshot-x-evm')
    expect(loadSxClient).toHaveBeenCalledWith({
      network: 'optimism',
      provider: PROVIDER,
      manaUrl: SX_MANA_URL,
      whitelistServerUrl: SX_WHITELIST_URL
    })

    expect(vote).toHaveBeenCalledTimes(1)
    const arg = vote.mock.lastCall![0] as { signer: unknown; data: SxVoteRequest }
    expect(arg.data.space).toBe(request().space)
    expect(arg.data.proposal).toBe(7)
    expect(arg.signer).toBe(signer)
  })

  it('loads the SDK at most once across concurrent votes', async () => {
    const loadSxClient = vi.fn().mockResolvedValue({
      vote: vi.fn().mockResolvedValue({})
    } as unknown as SxClient)
    const backend = createSnapshotXEvmBackend({
      config: { network: 'base', provider: PROVIDER },
      loadSxClient
    })
    const signer = createEthersCompatSigner('0xabc', vi.fn().mockResolvedValue('0xsig'))

    await Promise.all([backend.castVote(request(), signer), backend.castVote(request(), signer)])

    expect(loadSxClient).toHaveBeenCalledTimes(1)
  })

  it('honours custom Mana and whitelist URLs', async () => {
    const loadSxClient = vi.fn().mockResolvedValue({
      vote: vi.fn().mockResolvedValue({})
    } as unknown as SxClient)
    const backend = createSnapshotXEvmBackend({
      config: {
        network: 'optimism',
        provider: PROVIDER,
        manaUrl: 'https://mana.example',
        whitelistServerUrl: 'https://wls.example'
      },
      loadSxClient
    })

    await backend.castVote(request(), createEthersCompatSigner('0xabc', vi.fn().mockResolvedValue('0xsig')))

    expect(loadSxClient).toHaveBeenCalledWith({
      network: 'optimism',
      provider: PROVIDER,
      manaUrl: 'https://mana.example',
      whitelistServerUrl: 'https://wls.example'
    })
  })
})
