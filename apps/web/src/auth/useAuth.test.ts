import { beforeEach, describe, expect, it, vi } from 'vitest'

// useAuth owns module-level singleton state, so each test resets the module
// registry and re-imports it to start from a clean slate.
//
// That reset is exactly why the error classes and the mocked bridge live in a
// hoisted block: a mock factory's result is cached for the whole file, so these
// class identities stay stable while useAuth is re-imported each generation.
// (Real classes would come back as a *new* identity per generation, breaking
// the `instanceof` checks under test.)
const m = vi.hoisted(() => {
  class AppError extends Error {
    code: string
    params: Record<string, unknown>
    constructor(code: string, message: string, params: Record<string, unknown> = {}) {
      super(message)
      this.name = 'AppError'
      this.code = code
      this.params = params
    }
  }
  class SsoCodeRejectedError extends AppError {
    constructor(message: string) {
      super('ssoCodeRejected', message)
      this.name = 'SsoCodeRejectedError'
    }
  }
  class SsoRedirectingError extends Error {
    constructor(message = '正在跳转到 cos72 登录…') {
      super(message)
      this.name = 'SsoRedirectingError'
    }
  }
  return {
    AppError,
    SsoCodeRejectedError,
    SsoRedirectingError,
    ssoOnly: false,
    bridge: {
      hasSession: vi.fn(),
      restore: vi.fn(),
      consumeReturnTo: vi.fn()
    },
    providers: {
      wallet: { id: 'wallet', connect: vi.fn(), disconnect: vi.fn() },
      airaccount: { id: 'airaccount', connect: vi.fn(), disconnect: vi.fn() },
      email: { id: 'email', connect: vi.fn(), disconnect: vi.fn() }
    }
  }
})

vi.mock('../lib/errors', () => ({
  AppError: m.AppError,
  errorKey: () => undefined,
  resolveErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

vi.mock('../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config')>()
  return {
    ...actual,
    get SSO_ONLY() {
      return m.ssoOnly
    }
  }
})

vi.mock('./walletProvider', () => ({ createWalletProvider: () => m.providers.wallet }))
vi.mock('./airAccountProvider', () => ({ createAirAccountProvider: () => m.providers.airaccount }))
vi.mock('./emailProvider', () => ({ createEmailProvider: () => m.providers.email }))
vi.mock('./airAccountBridge', () => ({
  SsoCodeRejectedError: m.SsoCodeRejectedError,
  SsoRedirectingError: m.SsoRedirectingError,
  SsoNoSessionError: m.AppError,
  createAirAccountBridge: () => m.bridge
}))

async function loadAuth() {
  const { useAuth } = await import('./useAuth')
  return useAuth()
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  m.ssoOnly = false
  m.bridge.hasSession.mockReturnValue(false)
  m.bridge.restore.mockResolvedValue({ address: '0xsso' })
  m.bridge.consumeReturnTo.mockReturnValue(null)
  for (const p of Object.values(m.providers)) {
    p.connect.mockResolvedValue({ address: '0x' + p.id })
    p.disconnect.mockResolvedValue(undefined)
  }
})

describe('useAuth default provider', () => {
  it('defaults to the wallet when no SSO session is present', async () => {
    const auth = await loadAuth()
    expect(auth.activeProviderId.value).toBe('wallet')
    expect(auth.walletDisabled.value).toBe(false)
  })

  it('defaults to AirAccount in an SSO-only deployment', async () => {
    m.ssoOnly = true
    const auth = await loadAuth()
    expect(auth.activeProviderId.value).toBe('airaccount')
    expect(auth.ssoOnly).toBe(true)
    expect(auth.walletDisabled.value).toBe(true)
  })

  it('defaults to AirAccount when a stored session exists and disables the wallet', async () => {
    m.bridge.hasSession.mockReturnValue(true)
    const auth = await loadAuth()
    expect(auth.activeProviderId.value).toBe('airaccount')
    expect(auth.walletDisabled.value).toBe(true)
  })

  it('falls back to the wallet when the session probe throws', async () => {
    m.bridge.hasSession.mockImplementation(() => {
      throw new Error('storage blocked')
    })
    const auth = await loadAuth()
    expect(auth.activeProviderId.value).toBe('wallet')
    expect(auth.walletDisabled.value).toBe(false)
  })
})

describe('useAuth connect/disconnect', () => {
  it('stores the user and clears any earlier error', async () => {
    const auth = await loadAuth()
    m.providers.wallet.connect.mockRejectedValueOnce(new m.AppError('accountMismatch', 'nope'))
    await expect(auth.connect()).rejects.toThrow('nope')
    expect(auth.errorCode.value).toBe('accountMismatch')

    m.providers.wallet.connect.mockResolvedValueOnce({ address: '0xabc' })
    await auth.connect()
    expect(auth.user.value).toEqual({ address: '0xabc' })
    expect(auth.isConnected.value).toBe(true)
    expect(auth.error.value).toBeNull()
    expect(auth.errorCode.value).toBeNull()
  })

  it('keeps the raw message but no code for an uncoded failure', async () => {
    const auth = await loadAuth()
    m.providers.wallet.connect.mockRejectedValueOnce(new Error('boom'))
    await expect(auth.connect()).rejects.toThrow('boom')
    expect(auth.error.value).toBe('boom')
    expect(auth.errorCode.value).toBeNull()
    expect(auth.user.value).toBeNull()
  })

  it('treats a cos72 redirect as success-without-user, not an error', async () => {
    const auth = await loadAuth()
    m.providers.wallet.connect.mockRejectedValueOnce(new m.SsoRedirectingError())
    await expect(auth.connect()).resolves.toBeUndefined()
    expect(auth.error.value).toBeNull()
    expect(auth.user.value).toBeNull()
  })

  it('passes connect params through to the provider', async () => {
    const auth = await loadAuth()
    await auth.connect({ email: 'a@b.com' })
    expect(m.providers.wallet.connect).toHaveBeenCalledWith({ email: 'a@b.com' })
  })

  it('clears the user on disconnect', async () => {
    const auth = await loadAuth()
    await auth.connect()
    await auth.disconnect()
    expect(auth.user.value).toBeNull()
    expect(m.providers.wallet.disconnect).toHaveBeenCalledTimes(1)
  })
})

describe('useAuth setProvider', () => {
  it('is a no-op when the provider does not change', async () => {
    const auth = await loadAuth()
    await auth.setProvider('wallet')
    expect(m.providers.wallet.disconnect).not.toHaveBeenCalled()
    expect(auth.activeProviderId.value).toBe('wallet')
  })

  it('disconnects the old provider before switching', async () => {
    const auth = await loadAuth()
    await auth.connect()
    await auth.setProvider('airaccount')
    expect(m.providers.wallet.disconnect).toHaveBeenCalledTimes(1)
    expect(auth.activeProviderId.value).toBe('airaccount')
    expect(auth.user.value).toBeNull()
  })

  it('refuses to switch to the wallet while an SSO session is live', async () => {
    m.bridge.hasSession.mockReturnValue(true)
    const auth = await loadAuth()
    await auth.setProvider('wallet')
    expect(auth.activeProviderId.value).toBe('airaccount')
    expect(auth.errorCode.value).toBe('walletSwitchBlocked')
    expect(m.providers.wallet.disconnect).not.toHaveBeenCalled()
  })

  it('allows the switch away from the wallet on an SSO-only deployment', async () => {
    m.ssoOnly = true
    const auth = await loadAuth()
    await auth.setProvider('email')
    expect(auth.activeProviderId.value).toBe('email')
  })
})

describe('useAuth restoreSession', () => {
  it('does nothing without a session', async () => {
    const auth = await loadAuth()
    await auth.restoreSession()
    expect(m.bridge.restore).not.toHaveBeenCalled()
    expect(auth.activeProviderId.value).toBe('wallet')
    expect(auth.error.value).toBeNull()
  })

  it('restores the session and switches to AirAccount', async () => {
    m.bridge.hasSession.mockReturnValue(true)
    const auth = await loadAuth()
    await auth.restoreSession()
    expect(auth.user.value).toEqual({ address: '0xsso' })
    expect(auth.activeProviderId.value).toBe('airaccount')
    expect(auth.error.value).toBeNull()
  })

  it('surfaces a rejected code so the wallet dead end is not silent', async () => {
    m.bridge.hasSession.mockReturnValue(true)
    m.bridge.restore.mockRejectedValueOnce(new m.SsoCodeRejectedError('code 已失效'))
    const auth = await loadAuth()
    await auth.restoreSession()
    expect(auth.user.value).toBeNull()
    expect(auth.error.value).toContain('请重新登录')
    expect(auth.errorCode.value).toBe('ssoCodeRejected')
  })

  it('stays quiet on a transient restore failure', async () => {
    m.bridge.hasSession.mockReturnValue(true)
    m.bridge.restore.mockRejectedValueOnce(new Error('network'))
    const auth = await loadAuth()
    await auth.restoreSession()
    expect(auth.error.value).toBeNull()
    expect(auth.user.value).toBeNull()
  })
})

describe('useAuth completeSsoLogin / startLogin', () => {
  it('completes the round-trip and returns the original target', async () => {
    m.bridge.consumeReturnTo.mockReturnValue('/space/aastar.eth')
    const auth = await loadAuth()
    await expect(auth.completeSsoLogin()).resolves.toBe('/space/aastar.eth')
    expect(auth.user.value).toEqual({ address: '0xsso' })
    expect(auth.activeProviderId.value).toBe('airaccount')
  })

  it('falls back to the home route when no target was stored', async () => {
    const auth = await loadAuth()
    await expect(auth.completeSsoLogin()).resolves.toBe('/')
  })

  it('throws and records the failure so the callback page can render it', async () => {
    m.bridge.restore.mockRejectedValueOnce(new m.SsoCodeRejectedError('无效的 code'))
    const auth = await loadAuth()
    await expect(auth.completeSsoLogin()).rejects.toThrow('无效的 code')
    expect(auth.errorCode.value).toBe('ssoCodeRejected')
    expect(auth.user.value).toBeNull()
  })

  it('startLogin switches to AirAccount and starts a connect', async () => {
    const auth = await loadAuth()
    m.providers.airaccount.connect.mockRejectedValueOnce(new m.SsoRedirectingError())
    await auth.startLogin()
    expect(auth.activeProviderId.value).toBe('airaccount')
    expect(m.providers.airaccount.connect).toHaveBeenCalledTimes(1)
    expect(auth.error.value).toBeNull()
  })
})
