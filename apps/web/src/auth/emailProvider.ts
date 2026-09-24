import type { AuthProvider, AuthUser } from './types'

/**
 * Email sign-in — the **interim** substitute for AirAccount (M4) while cos72 SSO
 * and the E-5 KMS signer are blocked on other teams.
 *
 * Scope, deliberately: this establishes a lightweight identity only. It holds no
 * key, so it CANNOT sign an EIP-712 vote. Callers must treat a thrown
 * {@link EmailSigningUnsupportedError} as "sign-in works, voting does not" and
 * surface that in the UI. Replace this provider once AirAccount ships.
 *
 * Session lives in localStorage (survives reloads). It is an email string, not a
 * credential — there is no password and no verification, which is exactly why
 * this is a placeholder and not an auth system.
 */

export const EMAIL_SESSION_KEY = 'myvote.email.session'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** No email was supplied and no session is stored. */
export class EmailRequiredError extends Error {
  constructor(message = 'Email is required') {
    super(message)
    this.name = 'EmailRequiredError'
  }
}

/** The supplied string is not a usable email address. */
export class EmailInvalidError extends Error {
  constructor(message = 'Invalid email address') {
    super(message)
    this.name = 'EmailInvalidError'
  }
}

/**
 * Email sign-in has no key, so it cannot produce a signature. Distinct type so
 * the UI can explain *why* voting is unavailable rather than showing a generic
 * failure.
 */
export class EmailSigningUnsupportedError extends Error {
  constructor(message = 'Email sign-in cannot sign votes yet') {
    super(message)
    this.name = 'EmailSigningUnsupportedError'
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type EmailProviderOptions = {
  /** Injectable for tests; defaults to window.localStorage. */
  storage?: StorageLike
}

export function createEmailProvider(options: EmailProviderOptions = {}): AuthProvider {
  const store =
    options.storage ?? (typeof window === 'undefined' ? undefined : window.localStorage)

  function load(): AuthUser | null {
    const raw = store?.getItem(EMAIL_SESSION_KEY)
    if (!raw) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      const email =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as { email?: unknown }).email
          : undefined
      if (typeof email !== 'string' || !EMAIL_PATTERN.test(email)) return null
      return { displayName: email }
    } catch {
      // Corrupt entry — drop it rather than wedging sign-in forever.
      store?.removeItem(EMAIL_SESSION_KEY)
      return null
    }
  }

  return {
    id: 'email',
    name: 'Email',

    async connect(params) {
      const email = params?.email?.trim().toLowerCase() ?? ''
      if (email) {
        if (!EMAIL_PATTERN.test(email)) throw new EmailInvalidError()
        store?.setItem(EMAIL_SESSION_KEY, JSON.stringify({ email }))
        return { displayName: email }
      }
      const stored = load()
      if (stored) return stored
      throw new EmailRequiredError()
    },

    async disconnect() {
      store?.removeItem(EMAIL_SESSION_KEY)
    },

    getUser() {
      return load()
    },

    async signMessage() {
      throw new EmailSigningUnsupportedError()
    },

    async signTypedData() {
      throw new EmailSigningUnsupportedError()
    }
  }
}
