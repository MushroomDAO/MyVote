import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const completeSsoLogin = vi.fn()
const startLogin = vi.fn()
const authError = ref<string | null>(null)

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    error: authError,
    completeSsoLogin,
    startLogin
  })
}))

const replace = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' }
}))

// Imported after the mocks so the component picks them up.
const SsoCallbackPage = (await import('./SsoCallbackPage.vue')).default

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      ssoCompleting: 'Completing sign-in…',
      ssoFailed: 'Sign-in failed',
      ssoRetry: 'Log in again',
      loading: 'Loading…',
      explore: 'Explore'
    }
  }
})

function mountPage() {
  return mount(SsoCallbackPage, { global: { plugins: [i18n] } })
}

describe('SsoCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authError.value = null
  })

  it('spends the code and replaces to the deep link the user was headed for', async () => {
    completeSsoLogin.mockResolvedValueOnce('/proposal/0xabc?ref=x')

    const wrapper = mountPage()
    await flushPromises()

    expect(completeSsoLogin).toHaveBeenCalledTimes(1)
    // replace(), not push() — the callback URL must not linger in the back stack.
    expect(replace).toHaveBeenCalledWith('/proposal/0xabc?ref=x')
    expect(wrapper.text()).not.toContain('Sign-in failed')
  })

  it('falls back to home when there is no deep link', async () => {
    completeSsoLogin.mockResolvedValueOnce('/')

    mountPage()
    await flushPromises()

    expect(replace).toHaveBeenCalledWith('/')
  })

  it('shows the failure and a "log in again" button when the exchange fails', async () => {
    completeSsoLogin.mockRejectedValueOnce(new Error('SSO 交换失败 (401): invalid_grant'))
    authError.value = 'SSO 交换失败 (401): invalid_grant'

    const wrapper = mountPage()
    await flushPromises()

    expect(replace).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Sign-in failed')
    expect(wrapper.text()).toContain('invalid_grant')

    const retry = wrapper.find('button')
    expect(retry.text()).toBe('Log in again')

    await retry.trigger('click')
    expect(startLogin).toHaveBeenCalledTimes(1)
  })

  it('shows the loading state while the exchange is in flight', async () => {
    completeSsoLogin.mockReturnValueOnce(new Promise(() => {}))

    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('Completing sign-in…')
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
