import { describe, expect, it, vi } from 'vitest'

import {
  createHttpKmsSigner,
  eip191Digest,
  keyIdFromToken,
  KmsNotConfiguredError,
  toKmsTypedData
} from './kms'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/** A JWT whose payload carries the claims we care about (its signature is not checked here). */
function jwt(claims: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
}

const SIGNATURE = '0x' + '11'.repeat(65)

function typedData() {
  return {
    domain: { name: 'snapshot', version: '0.1.4' },
    types: {
      EIP712Domain: [{ name: 'name', type: 'string' }],
      Vote: [{ name: 'choice', type: 'uint32' }]
    },
    primaryType: 'Vote',
    message: { choice: 1 }
  }
}

function request() {
  return { aaAddress: '0xaa', token: jwt({ keyId: 'wallet-1:0' }), typedData: typedData() }
}

describe('toKmsTypedData', () => {
  it('maps structs to the KMS array form and drops EIP712Domain', () => {
    const { types, message } = toKmsTypedData(typedData() as never)
    expect(types).toEqual([{ name: 'Vote', fields: [{ name: 'choice', type: 'uint32' }] }])
    expect(message).toEqual([{ name: 'choice', value: 1 }])
  })
})

describe('keyIdFromToken', () => {
  it('reads an unprefixed or snake_case keyId claim', () => {
    expect(keyIdFromToken(jwt({ keyId: 'wallet-1:0' }))).toBe('wallet-1:0')
    expect(keyIdFromToken(jwt({ key_id: 'abc' }))).toBe('abc')
  })

  it('returns null when the claim is missing or the token is malformed', () => {
    expect(keyIdFromToken(jwt({ sub: 'x' }))).toBeNull()
    expect(keyIdFromToken('not-a-jwt')).toBeNull()
    expect(keyIdFromToken('a.%%%%-not-base64.zz')).toBeNull()
  })
})

describe('eip191Digest', () => {
  it('is a deterministic 32-byte digest', () => {
    const digest = eip191Digest('hello')
    expect(digest).toMatch(/^0x[0-9a-f]{64}$/)
    expect(eip191Digest('hello')).toBe(digest)
    expect(eip191Digest('hellp')).not.toBe(digest)
  })
})

describe('createHttpKmsSigner', () => {
  it('rejects an empty endpoint', () => {
    expect(() => createHttpKmsSigner({ endpoint: '' })).toThrow(KmsNotConfiguredError)
  })

  it('posts EIP-712 payloads to /kms/SignTypedData with agent auth', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ keyId: 'wallet-1:0', signature: SIGNATURE }))
    const signer = createHttpKmsSigner({ endpoint: 'https://kms.test/', fetchImpl: fetchImpl as never })

    await expect(signer.signTypedData(request())).resolves.toBe(SIGNATURE)

    const [url, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string>; body: string }]
    expect(url).toBe('https://kms.test/kms/SignTypedData')
    expect(init.headers['x-amz-target']).toBe('TrentService.SignTypedData')
    expect(init.headers['content-type']).toBe('application/json')
    expect(init.headers.authorization).toBe(`Bearer ${request().token}`)

    const body = JSON.parse(init.body)
    expect(body.keyId).toBe('wallet-1:0')
    expect(body.primaryType).toBe('Vote')
    expect(body.domain).toEqual({ name: 'snapshot', version: '0.1.4' })
    expect(body.types).toEqual([{ name: 'Vote', fields: [{ name: 'choice', type: 'uint32' }] }])
    expect(body.message).toEqual([{ name: 'choice', value: 1 }])
  })

  it('sends the API key when configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ signature: SIGNATURE }))
    const signer = createHttpKmsSigner({
      endpoint: 'https://kms.test',
      apiKey: 'server-key',
      fetchImpl: fetchImpl as never
    })

    await signer.signTypedData(request())
    const [, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(init.headers['x-api-key']).toBe('server-key')
  })

  it('refuses to sign when no keyId can be resolved', async () => {
    const fetchImpl = vi.fn()
    const signer = createHttpKmsSigner({ endpoint: 'https://kms.test', fetchImpl: fetchImpl as never })
    await expect(signer.signTypedData({ ...request(), token: 'garbage' })).rejects.toThrow(
      /keyId is unavailable/
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('surfaces the KMS status and detail on a bad response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'unauthorized' }, 400))
    const signer = createHttpKmsSigner({ endpoint: 'https://kms.test', fetchImpl: fetchImpl as never })
    await expect(signer.signTypedData(request())).rejects.toThrow(
      /KMS SignTypedData failed \(400\): unauthorized/
    )
  })

  it('rejects a response that is not a 65-byte signature', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ signature: '0xdead' }))
    const signer = createHttpKmsSigner({ endpoint: 'https://kms.test', fetchImpl: fetchImpl as never })
    await expect(signer.signTypedData(request())).rejects.toThrow(/65-byte signature/)
  })

  it('signs EIP-191 messages through /kms/SignHash with the digest', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ Signature: '0x' + '22'.repeat(65) }))
    const signer = createHttpKmsSigner({ endpoint: 'https://kms.test', fetchImpl: fetchImpl as never })

    await expect(
      signer.signMessage({ aaAddress: '0xaa', token: jwt({ keyId: 'wallet-1:0' }), message: 'hello' })
    ).resolves.toBe('0x' + '22'.repeat(65))

    const [url, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string>; body: string }]
    expect(url).toBe('https://kms.test/kms/SignHash')
    expect(init.headers['x-amz-target']).toBe('TrentService.SignHash')
    const body = JSON.parse(init.body)
    expect(body.Address).toBe('0xaa')
    expect(body.Hash).toBe(eip191Digest('hello'))
  })
})
