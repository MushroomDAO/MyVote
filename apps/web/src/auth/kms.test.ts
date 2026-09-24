import { describe, expect, it } from 'vitest'

import { createPlaceholderKmsSigner, KmsNotConfiguredError } from './kms'

describe('KmsNotConfiguredError', () => {
  it('is an Error with a stable name and default message', () => {
    const err = new KmsNotConfiguredError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('KmsNotConfiguredError')
    expect(err.message).toBe('E-5 pending')
  })

  it('accepts a custom message', () => {
    expect(new KmsNotConfiguredError('custom').message).toBe('custom')
  })
})

describe('createPlaceholderKmsSigner', () => {
  it('throws KmsNotConfiguredError from signTypedData', async () => {
    const signer = createPlaceholderKmsSigner()
    await expect(
      signer.signTypedData({
        aaAddress: '0xaa',
        token: 'jwt',
        typedData: { domain: {}, types: {}, primaryType: 'Vote', message: {} }
      })
    ).rejects.toBeInstanceOf(KmsNotConfiguredError)
  })

  it('throws KmsNotConfiguredError from signMessage', async () => {
    const signer = createPlaceholderKmsSigner()
    await expect(
      signer.signMessage({ aaAddress: '0xaa', token: 'jwt', message: 'hi' })
    ).rejects.toBeInstanceOf(KmsNotConfiguredError)
  })

  it('names the missing endpoint so logs point at E-5', async () => {
    const signer = createPlaceholderKmsSigner()
    await expect(
      signer.signMessage({ aaAddress: '0xaa', token: 'jwt', message: 'hi' })
    ).rejects.toThrow('KMS signMessage endpoint not configured')
    await expect(
      signer.signTypedData({
        aaAddress: '0xaa',
        token: 'jwt',
        typedData: { domain: {}, types: {}, primaryType: 'Vote', message: {} }
      })
    ).rejects.toThrow('KMS signTypedData endpoint not configured')
  })
})
