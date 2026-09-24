import { describe, expect, it, vi } from 'vitest'

import { createAirAccountProvider, type AirAccountAdapter } from './airAccountProvider'

function adapter(overrides: Partial<AirAccountAdapter> = {}): AirAccountAdapter {
  return {
    connect: vi.fn().mockResolvedValue({ address: '0xaa', displayName: 'alice@example.com' }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    signMessage: vi.fn().mockResolvedValue('0xmsg'),
    signTypedData: vi.fn().mockResolvedValue('0xtyped'),
    ...overrides
  }
}

describe('createAirAccountProvider', () => {
  it('exposes AirAccount identity metadata', () => {
    const provider = createAirAccountProvider(adapter())
    expect(provider.id).toBe('airaccount')
    expect(provider.name).toBe('AirAccount')
    expect(provider.getUser()).toBeNull()
  })

  it('fails loudly when no adapter is wired', async () => {
    const provider = createAirAccountProvider()
    await expect(provider.connect()).rejects.toThrow('AirAccount adapter not configured')
    await expect(provider.signMessage('0xaa', 'hi')).rejects.toThrow(
      'AirAccount adapter not configured'
    )
    await expect(
      provider.signTypedData({ address: '0xaa', typedData: {} })
    ).rejects.toThrow('AirAccount adapter not configured')
  })

  it('stores the user returned by the adapter', async () => {
    const a = adapter()
    const provider = createAirAccountProvider(a)
    await expect(provider.connect()).resolves.toEqual({
      address: '0xaa',
      displayName: 'alice@example.com'
    })
    expect(provider.getUser()).toEqual({ address: '0xaa', displayName: 'alice@example.com' })
  })

  it('delegates signing to the adapter', async () => {
    const a = adapter()
    const provider = createAirAccountProvider(a)

    await expect(provider.signMessage('0xaa', 'hello')).resolves.toBe('0xmsg')
    expect(a.signMessage).toHaveBeenCalledWith('0xaa', 'hello')

    const typedData = { domain: {}, types: {}, primaryType: 'Vote', message: {} }
    await expect(provider.signTypedData({ address: '0xaa', typedData })).resolves.toBe('0xtyped')
    expect(a.signTypedData).toHaveBeenCalledWith({ address: '0xaa', typedData })
  })

  it('clears the user and delegates disconnect when the adapter supports it', async () => {
    const a = adapter()
    const provider = createAirAccountProvider(a)
    await provider.connect()
    await provider.disconnect()

    expect(a.disconnect).toHaveBeenCalledTimes(1)
    expect(provider.getUser()).toBeNull()
  })

  it('tolerates an adapter without a disconnect hook', async () => {
    const a = adapter({ disconnect: undefined })
    const provider = createAirAccountProvider(a)
    await provider.connect()
    await expect(provider.disconnect()).resolves.toBeUndefined()
    expect(provider.getUser()).toBeNull()
  })

  it('can disconnect even with no adapter configured', async () => {
    const provider = createAirAccountProvider()
    await expect(provider.disconnect()).resolves.toBeUndefined()
    expect(provider.getUser()).toBeNull()
  })
})
