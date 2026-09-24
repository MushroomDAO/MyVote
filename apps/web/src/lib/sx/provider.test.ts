import { describe, expect, it, vi } from 'vitest'

import { SX_MANA_URL, SX_WHITELIST_URL, type SxClient } from './backend'
import {
  createSxBackendFromEip1193,
  toHexQuantity,
  wrapEip1193,
  type Eip1193Provider
} from './provider'

describe('toHexQuantity', () => {
  it('converts numbers, decimal strings and bigints; passes hex through', () => {
    expect(toHexQuantity(255)).toBe('0xff')
    expect(toHexQuantity(0)).toBe('0x0')
    expect(toHexQuantity('255')).toBe('0xff')
    expect(toHexQuantity('0xabc')).toBe('0xabc')
    expect(toHexQuantity(10n)).toBe('0xa')
    expect(toHexQuantity(undefined)).toBeUndefined()
  })
})

function fakeEip1193(handlers: Record<string, (params?: unknown) => unknown>): Eip1193Provider {
  return {
    request: vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
      const handler = handlers[method]
      if (!handler) throw new Error('unexpected method ' + method)
      return handler(params)
    }) as unknown as Eip1193Provider['request']
  }
}

describe('wrapEip1193', () => {
  it('forwards eth_chainId and returns a numeric chainId', async () => {
    const provider = wrapEip1193(fakeEip1193({ eth_chainId: () => '0xa' }))
    expect(await provider.getNetwork()).toEqual({ chainId: 10, name: '' })
  })

  it('maps call() to eth_call and hex-encodes numeric value/gas', async () => {
    const request = vi.fn(async () => '0xresult')
    const provider = wrapEip1193({ request } as unknown as Eip1193Provider)

    const out = await provider.call({
      to: '0xabc',
      data: '0xdead',
      from: '0xdef',
      value: 1,
      gas: 21000
    })

    expect(out).toBe('0xresult')
    expect(request).toHaveBeenCalledWith({
      method: 'eth_call',
      params: [{ to: '0xabc', data: '0xdead', from: '0xdef', value: '0x1', gas: '0x5208' }, 'latest']
    })
  })

  it('maps getLogs with block tags', async () => {
    const request = vi.fn(async () => [])
    const provider = wrapEip1193({ request } as unknown as Eip1193Provider)

    await provider.getLogs({ address: '0xabc', topics: ['0x1'], fromBlock: 100, toBlock: 'latest' })

    expect(request).toHaveBeenCalledWith({
      method: 'eth_getLogs',
      params: [{ address: '0xabc', topics: ['0x1'], fromBlock: '0x64', toBlock: 'latest' }]
    })
  })

  it('reads block number, code, storage, nonce and balance', async () => {
    const provider = wrapEip1193(
      fakeEip1193({
        eth_blockNumber: () => '0x10',
        eth_getCode: () => '0x6000',
        eth_getStorageAt: () => '0x0',
        eth_getTransactionCount: () => '0x5',
        eth_getBalance: () => '0xde0b6b3a7640000'
      })
    )

    expect(await provider.getBlockNumber()).toBe(16)
    expect(await provider.getCode('0xabc')).toBe('0x6000')
    expect(await provider.getStorageAt('0xabc', 3)).toBe('0x0')
    expect(await provider.getTransactionCount('0xabc')).toBe(5)
    expect(await provider.getBalance('0xabc')).toBe('0xde0b6b3a7640000')
  })
})

describe('createSxBackendFromEip1193', () => {
  it('wraps the wallet and hands the SX client a wrapped provider', async () => {
    const envelope = { signatureData: {}, data: {} }
    const vote = vi.fn().mockResolvedValue(envelope)
    const send = vi.fn().mockResolvedValue({ id: 'sx' })
    const loadSxClient = vi.fn().mockResolvedValue({ vote, send } as unknown as SxClient)
    const backend = createSxBackendFromEip1193({
      network: 'optimism',
      eip1193: fakeEip1193({}),
      loadSxClient
    })

    expect(backend.id).toBe('snapshot-x-evm')
    await backend.castVote(
      {
        space: '0x1',
        authenticator: '0x2',
        strategies: [],
        proposal: 1,
        choice: 1,
        metadataUri: ''
      },
      {
        getAddress: async () => '0xabc',
        signTypedData: async () => '0x0',
        _signTypedData: async () => '0x0'
      }
    )

    expect(send).toHaveBeenCalledWith(envelope)
    expect(loadSxClient).toHaveBeenCalledWith(
      expect.objectContaining({
        network: 'optimism',
        manaUrl: SX_MANA_URL,
        whitelistServerUrl: SX_WHITELIST_URL,
        provider: expect.objectContaining({ provider: expect.anything() })
      })
    )
  })
})
