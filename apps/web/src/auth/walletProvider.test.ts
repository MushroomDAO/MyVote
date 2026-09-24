import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createWalletProvider } from './walletProvider'

type RequestArgs = { method: string; params?: unknown[] | Record<string, unknown> }
type Ethereum = { request(args: RequestArgs): Promise<unknown> }

const request = vi.fn<(args: RequestArgs) => Promise<unknown>>()

/** Installs (or removes) the injected EIP-1193 provider the module reads. */
function setWallet(ethereum: Ethereum | null) {
  if (ethereum) {
    ;(window as unknown as { ethereum?: Ethereum }).ethereum = ethereum
  } else {
    delete (window as unknown as { ethereum?: Ethereum }).ethereum
  }
}

function typedParams(): { types: Record<string, unknown> } {
  const call = request.mock.calls[request.mock.calls.length - 1] as [RequestArgs]
  const params = call[0].params as [unknown, string]
  return JSON.parse(params[1])
}

beforeEach(() => {
  request.mockReset()
  setWallet({ request })
})

afterEach(() => {
  setWallet(null)
})

describe('walletProvider connect', () => {
  it('exposes wallet identity metadata', () => {
    const provider = createWalletProvider()
    expect(provider.id).toBe('wallet')
    expect(provider.name).toBe('Wallet')
    expect(provider.getUser()).toBeNull()
  })

  it('throws when no wallet is injected', async () => {
    setWallet(null)
    const provider = createWalletProvider()
    await expect(provider.connect()).rejects.toThrow('No injected wallet found')
  })

  it('throws when the wallet exposes no account', async () => {
    request.mockResolvedValueOnce([])
    const provider = createWalletProvider()
    await expect(provider.connect()).rejects.toThrow('No account selected')
  })

  it('requests accounts and stores the first one', async () => {
    request.mockResolvedValueOnce(['0xabc', '0xdef'])
    const provider = createWalletProvider()
    await expect(provider.connect()).resolves.toEqual({ address: '0xabc' })
    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
    expect(provider.getUser()).toEqual({ address: '0xabc' })
  })

  it('forgets the account on disconnect', async () => {
    request.mockResolvedValueOnce(['0xabc'])
    const provider = createWalletProvider()
    await provider.connect()
    await provider.disconnect()
    expect(provider.getUser()).toBeNull()
  })
})

describe('walletProvider signing', () => {
  it('signs a plain message with personal_sign', async () => {
    request.mockResolvedValueOnce('0xsig')
    const provider = createWalletProvider()
    await expect(provider.signMessage('0xabc', 'hello')).resolves.toBe('0xsig')
    expect(request).toHaveBeenCalledWith({
      method: 'personal_sign',
      params: ['hello', '0xabc']
    })
  })

  it('requires an injected wallet to sign a message', async () => {
    setWallet(null)
    const provider = createWalletProvider()
    await expect(provider.signMessage('0xabc', 'hello')).rejects.toThrow('No injected wallet found')
  })

  it('requires an injected wallet to sign typed data', async () => {
    setWallet(null)
    const provider = createWalletProvider()
    await expect(
      provider.signTypedData({ address: '0xabc', typedData: { domain: {}, types: {} } })
    ).rejects.toThrow('No injected wallet found')
  })

  it('re-adds only the EIP712Domain fields the payload carries, in canonical order', async () => {
    request.mockResolvedValueOnce('0xsignature')
    const provider = createWalletProvider()
    const typedData = {
      domain: { name: 'snapshot', version: '1', chainId: 1 },
      types: { Vote: [{ name: 'choice', type: 'uint32' }] },
      primaryType: 'Vote',
      message: { choice: 1 }
    }

    await expect(provider.signTypedData({ address: '0xabc', typedData })).resolves.toBe('0xsignature')

    expect(request).toHaveBeenCalledTimes(1)
    const call = request.mock.calls[0]![0]
    expect(call.method).toBe('eth_signTypedData_v4')
    expect((call.params as [unknown, unknown])[0]).toBe('0xabc')

    const parsed = typedParams()
    expect(parsed.types.EIP712Domain).toEqual([
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' }
    ])
    // The application types ride along untouched.
    expect(parsed.types.Vote).toEqual([{ name: 'choice', type: 'uint32' }])
  })

  it('includes verifyingContract and salt only when present', async () => {
    request.mockResolvedValueOnce('0xsig')
    const provider = createWalletProvider()
    await provider.signTypedData({
      address: '0xabc',
      typedData: {
        domain: { name: 'snapshot', chainId: 1, verifyingContract: '0x0000000000000000000000000000000000000000' },
        types: { Vote: [] }
      }
    })

    expect(typedParams().types.EIP712Domain).toEqual([
      { name: 'name', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' }
    ])
  })

  it('leaves an explicit EIP712Domain untouched', async () => {
    request.mockResolvedValueOnce('0xsig')
    const provider = createWalletProvider()
    const explicit = [{ name: 'name', type: 'string' }]
    await provider.signTypedData({
      address: '0xabc',
      typedData: { domain: { name: 'snapshot' }, types: { EIP712Domain: explicit, Vote: [] } }
    })

    expect(typedParams().types.EIP712Domain).toEqual(explicit)
  })

  it('leaves a payload without domain/types untouched', async () => {
    request.mockResolvedValueOnce('0xsig')
    const provider = createWalletProvider()
    await provider.signTypedData({ address: '0xabc', typedData: { types: { Vote: [] }, message: {} } })

    const parsed = typedParams()
    expect(parsed.types).toEqual({ Vote: [] })
    expect(parsed.types.EIP712Domain).toBeUndefined()
  })

  it('passes a non-object payload through as JSON', async () => {
    request.mockResolvedValueOnce('0xsig')
    const provider = createWalletProvider()
    await provider.signTypedData({ address: '0xabc', typedData: 'raw-payload' })

    const params = request.mock.calls[0]![0].params as [unknown, unknown]
    expect(params[1]).toBe('"raw-payload"')
  })
})
