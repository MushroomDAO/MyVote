import { RouterLinkStub, enableAutoUnmount, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

enableAutoUnmount(afterEach)

const h = vi.hoisted(() => ({
  setLocale: vi.fn(),
  tenant: { spaceId: null as string | null },
  branding: { name: 'MyVote', logo: null as string | null },
  auth: {
    walletDisabled: null,
    activeProviderId: null,
    isConnected: null,
    error: null,
    errorCode: null,
    user: null,
    setProvider: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    restoreSession: vi.fn()
  } as Record<string, unknown>
}))

vi.mock('./auth/useAuth', () => ({ useAuth: () => h.auth }))
vi.mock('./tenant', () => ({ tenant: h.tenant, resolvedBranding: h.branding }))
vi.mock('./i18n', () => ({ setLocale: h.setLocale }))

const App = (await import('./App.vue')).default

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      appTitle: 'APP_TITLE',
      explore: 'EXPLORE',
      register: 'REGISTER',
      loginProvider: 'Provider',
      emailLogin: 'EMAIL',
      language: 'Language',
      emailPlaceholder: 'EMAIL_PH',
      login: 'LOGIN',
      logout: 'LOGOUT',
      errAccountMismatch: 'ERR_ACCOUNT'
    }
  }
})

function mountApp() {
  // RouterLink/RouterView are registered globally by the router plugin in the
  // real app; stub them here.
  return mount(App, {
    global: { plugins: [i18n], stubs: { RouterLink: RouterLinkStub, RouterView: true } }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.tenant.spaceId = null
  h.branding.logo = null
  h.auth.walletDisabled = ref(false)
  h.auth.activeProviderId = ref('wallet')
  h.auth.isConnected = ref(false)
  h.auth.error = ref(null)
  h.auth.errorCode = ref(null)
  h.auth.user = ref(null)
})

describe('App shell branding', () => {
  it('renders the app title when no logo is configured', () => {
    const wrapper = mountApp()
    expect(wrapper.find('.logo').exists()).toBe(false)
    expect(wrapper.text()).toContain('APP_TITLE')
  })

  it('renders the tenant logo when configured', () => {
    h.branding.logo = '/logo.png'
    const wrapper = mountApp()
    expect(wrapper.get('.logo').attributes('src')).toBe('/logo.png')
  })

  it('hides the register link in single-space tenant mode', () => {
    const open = mountApp()
    expect(open.text()).toContain('REGISTER')
    open.unmount()

    h.tenant.spaceId = 'aastar.eth'
    const single = mountApp()
    expect(single.text()).not.toContain('REGISTER')
  })
})

describe('App shell auth controls', () => {
  it('restores the session on mount', () => {
    mountApp()
    expect(h.auth.restoreSession).toHaveBeenCalledTimes(1)
  })

  it('hides the wallet option when the wallet is disabled', () => {
    h.auth.walletDisabled = ref(true)
    const wrapper = mountApp()
    expect(wrapper.get('#provider').text()).not.toContain('Wallet')
  })

  it('asks for an email only when the email provider is selected and signed out', async () => {
    h.auth.activeProviderId = ref('email')
    const wrapper = mountApp()
    const input = wrapper.get('input[type="email"]')
    await input.setValue('alice@example.com')

    await wrapper.get('.button').trigger('click')
    expect(h.auth.connect).toHaveBeenCalledWith({ email: 'alice@example.com' })
  })

  it('shows the logged-out label and no address when not connected', () => {
    const wrapper = mountApp()
    expect(wrapper.get('.button').text()).toBe('LOGIN')
    expect(wrapper.find('.address').exists()).toBe(false)
  })

  it('does not ask for an email once connected', () => {
    h.auth.activeProviderId = ref('email')
    h.auth.isConnected = ref(true)
    const wrapper = mountApp()
    expect(wrapper.find('input[type="email"]').exists()).toBe(false)
  })

  it('disconnects on click when already connected', async () => {
    h.auth.isConnected = ref(true)
    const wrapper = mountApp()
    expect(wrapper.get('.button').text()).toBe('LOGOUT')
    await wrapper.get('.button').trigger('click')
    expect(h.auth.disconnect).toHaveBeenCalledTimes(1)
    expect(h.auth.connect).not.toHaveBeenCalled()
  })

  it('truncates the connected address', () => {
    h.auth.isConnected = ref(true)
    h.auth.user = ref({ address: '0x1234567890abcdef' })
    const wrapper = mountApp()
    expect(wrapper.get('.address').text()).toBe('0x1234…cdef')
  })

  it('switches the provider through setProvider', async () => {
    const wrapper = mountApp()
    await wrapper.get('#provider').setValue('airaccount')
    expect(h.auth.setProvider).toHaveBeenCalledWith('airaccount')
  })

  it('switches the locale through setLocale', async () => {
    const wrapper = mountApp()
    await wrapper.get('#lang').setValue('en')
    expect(h.setLocale).toHaveBeenCalledWith('en')
  })
})

describe('App shell error banner', () => {
  it('renders nothing without an error', () => {
    const wrapper = mountApp()
    expect(wrapper.find('.error').exists()).toBe(false)
  })

  it('falls back to the raw message for an uncoded error', () => {
    h.auth.error = ref('raw boom')
    const wrapper = mountApp()
    expect(wrapper.get('.error').text()).toBe('raw boom')
  })

  it('localizes a coded error', () => {
    h.auth.error = ref('raw boom')
    h.auth.errorCode = ref('accountMismatch')
    const wrapper = mountApp()
    expect(wrapper.get('.error').text()).toBe('ERR_ACCOUNT')
  })
})
