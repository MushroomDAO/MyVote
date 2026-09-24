import { describe, expect, it } from 'vitest'

import {
  createEmailProvider,
  EmailInvalidError,
  EmailRequiredError,
  EmailSigningUnsupportedError,
  EMAIL_SESSION_KEY
} from './emailProvider'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
    raw: map
  }
}

describe('emailProvider', () => {
  it('signs in with a valid email and persists the session', async () => {
    const storage = memoryStorage()
    const provider = createEmailProvider({ storage })

    const user = await provider.connect({ email: 'Alice@Example.com' })

    expect(user.displayName).toBe('alice@example.com')
    expect(provider.getUser()?.displayName).toBe('alice@example.com')
    expect(JSON.parse(storage.raw.get(EMAIL_SESSION_KEY) ?? '{}')).toEqual({
      email: 'alice@example.com'
    })
  })

  it('rejects a malformed email', async () => {
    const provider = createEmailProvider({ storage: memoryStorage() })
    await expect(provider.connect({ email: 'not-an-email' })).rejects.toBeInstanceOf(
      EmailInvalidError
    )
  })

  it('requires an email when there is no stored session', async () => {
    const provider = createEmailProvider({ storage: memoryStorage() })
    await expect(provider.connect()).rejects.toBeInstanceOf(EmailRequiredError)
  })

  it('restores a stored session without an email argument', async () => {
    const storage = memoryStorage()
    const provider = createEmailProvider({ storage })
    await provider.connect({ email: 'bob@example.com' })

    const fresh = createEmailProvider({ storage })
    const user = await fresh.connect()
    expect(user.displayName).toBe('bob@example.com')
  })

  it('ignores a corrupt stored session', async () => {
    const storage = memoryStorage()
    storage.setItem(EMAIL_SESSION_KEY, '{not json')
    const provider = createEmailProvider({ storage })

    await expect(provider.connect()).rejects.toBeInstanceOf(EmailRequiredError)
    expect(storage.raw.has(EMAIL_SESSION_KEY)).toBe(false)
  })

  it('clears the session on disconnect', async () => {
    const storage = memoryStorage()
    const provider = createEmailProvider({ storage })
    await provider.connect({ email: 'bob@example.com' })

    await provider.disconnect()
    expect(provider.getUser()).toBeNull()
    await expect(provider.connect()).rejects.toBeInstanceOf(EmailRequiredError)
  })

  it('cannot sign — that is the whole point of the placeholder', async () => {
    const provider = createEmailProvider({ storage: memoryStorage() })
    await expect(provider.signMessage('0x0', 'hi')).rejects.toBeInstanceOf(
      EmailSigningUnsupportedError
    )
    await expect(
      provider.signTypedData({ address: 'ear', typedData: {} })
    ).rejects.toBeInstanceOf(EmailSigningUnsupportedError)
  })
})
