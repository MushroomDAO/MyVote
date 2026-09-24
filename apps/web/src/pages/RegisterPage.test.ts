import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

enableAutoUnmount(afterEach)

vi.mock('../config', () => ({ REGISTER_ROOT_DOMAIN: 'example.com' }))

const authState = vi.hoisted(() => ({
  connected: true,
  address: '0x1111111111111111111111111111111111111111' as string | null,
  connect: vi.fn(),
  signMessage: vi.fn()
}))

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    isConnected: { value: authState.connected },
    user: { value: authState.address ? { address: authState.address } : null },
    provider: { value: { signMessage: authState.signMessage } },
    connect: authState.connect
  })
}))

const RegisterPage = (await import('./RegisterPage.vue')).default

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      register: 'Register',
      registerDesc: 'create a community',
      communityName: 'Community name',
      communityNameHint: 'name hint',
      checking: 'CHECKING',
      nameAvailable: 'NAME_AVAILABLE',
      nameTaken: 'NAME_TAKEN',
      nameInvalid: 'NAME_INVALID',
      snapshotSpaceId: 'space id',
      snapshotSpaceHint: 'space hint',
      communityDesc: 'desc',
      contactEmail: 'Email',
      contactEmailHint: 'email hint',
      ownershipTitle: 'Ownership',
      ownershipHint: 'ownership hint',
      ownershipSigning: 'OWNERSHIP_SIGNING',
      ownershipVerify: 'OWNERSHIP_VERIFY',
      ownershipVerified: 'OWNERSHIP_VERIFIED',
      noAccount: 'NO_ACCOUNT',
      emailInvalid: 'EMAIL_INVALID',
      registerBtn: 'REGISTER_BTN',
      registerError: 'REGISTER_ERROR',
      registerSuccess: 'REGISTER_SUCCESS',
      registerSuccessDesc: 'it worked',
      loading: 'LOADING'
    }
  }
})

const fetchMock = vi.fn()

/** Minimal Response stand-in: the page only reads ok + json(). */
function json(body: unknown, ok = true) {
  return { ok, json: async () => body }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function mountPage() {
  const wrapper = mount(RegisterPage, { global: { plugins: [i18n] } })
  await flushPromises()
  return wrapper
}

/** Types a name and lets the 500 ms debounce fire; /api/check resolves available. */
async function becomeAvailable(wrapper: ReturnType<typeof mount>, name = 'bread') {
  await wrapper.get('#name').setValue(name)
  await sleep(600)
  await flushPromises()
}

async function fillReady(wrapper: ReturnType<typeof mount>) {
  await becomeAvailable(wrapper)
  await wrapper.get('#spaceId').setValue('aastar.eth')
  await wrapper.get('#email').setValue('Alice@Example.com ')
  await flushPromises()
}

function lastBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/register').pop()
  return JSON.parse((call?.[1] as { body: string }).body)
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.connected = true
  authState.address = '0x1111111111111111111111111111111111111111'
  authState.connect.mockResolvedValue(undefined)
  authState.signMessage.mockResolvedValue('0xsig')
  fetchMock.mockImplementation(async (input: unknown) => {
    const url = String(input)
    if (url.startsWith('/api/check')) {
      return json({ available: true, domain: 'bread.example.com' })
    }
    return json({ success: true, url: 'https://bread.example.com' })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RegisterPage name availability', () => {
  it('checks the lowercased name after the debounce and enables submit', async () => {
    const wrapper = await mountPage()
    await becomeAvailable(wrapper, 'Bread')

    expect(fetchMock).toHaveBeenCalledWith('/api/check?name=bread')
    expect(wrapper.text()).toContain('NAME_AVAILABLE')

    await wrapper.get('#spaceId').setValue('aastar.eth')
    await wrapper.get('#email').setValue('alice@example.com')
    await flushPromises()

    expect(wrapper.get('.submitBtn').attributes('disabled')).toBeUndefined()
  })

  it('flags an invalid name locally and never calls the API', async () => {
    const wrapper = await mountPage()
    await wrapper.get('#name').setValue('ab')
    await sleep(600)
    await flushPromises()

    expect(wrapper.text()).toContain('NAME_INVALID')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a taken name and keeps submit disabled', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.startsWith('/api/check')) {
        return json({ available: false, domain: 'bread.example.com' })
      }
      return json({ success: true })
    })
    const wrapper = await mountPage()
    await becomeAvailable(wrapper)

    expect(wrapper.text()).toContain('NAME_TAKEN')
    await wrapper.get('#spaceId').setValue('aastar.eth')
    await wrapper.get('#email').setValue('alice@example.com')
    await flushPromises()
    expect(wrapper.get('.submitBtn').attributes('disabled')).toBeDefined()
  })

  it('surfaces a check error returned by the endpoint', async () => {
    fetchMock.mockImplementation(async () => json({ error: 'RATE_LIMITED' }))
    const wrapper = await mountPage()
    await becomeAvailable(wrapper)

    expect(wrapper.text()).toContain('RATE_LIMITED')
  })

  it('keeps submit disabled while the email is invalid and posts nothing', async () => {
    const wrapper = await mountPage()
    await becomeAvailable(wrapper)
    await wrapper.get('#spaceId').setValue('aastar.eth')
    await wrapper.get('#email').setValue('not-an-email')
    await flushPromises()

    expect(wrapper.get('.submitBtn').attributes('disabled')).toBeDefined()
    await wrapper.get('.submitBtn').trigger('click')
    await flushPromises()
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/register')).toBe(false)
  })
})

describe('RegisterPage submission', () => {
  it('posts the trimmed payload and renders the success link', async () => {
    const wrapper = await mountPage()
    await fillReady(wrapper)
    await wrapper.get('.submitBtn').trigger('click')
    await flushPromises()

    expect(lastBody()).toEqual({
      name: 'bread',
      spaceId: 'aastar.eth',
      description: '',
      email: 'alice@example.com'
    })
    expect(wrapper.text()).toContain('REGISTER_SUCCESS')
    expect(wrapper.get('.successLink').attributes('href')).toBe('https://bread.example.com')
    // The form is replaced by the success card.
    expect(wrapper.find('.submitBtn').exists()).toBe(false)
  })

  it('falls back to registerError when the response carries no message', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.startsWith('/api/check')) {
        return json({ available: true, domain: 'bread.example.com' })
      }
      return json({}, false)
    })
    const wrapper = await mountPage()
    await fillReady(wrapper)
    await wrapper.get('.submitBtn').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('REGISTER_ERROR')
    expect(wrapper.get('.submitBtn').attributes('disabled')).toBeUndefined()
  })

  it('shows a thrown network error', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.startsWith('/api/check')) {
        return json({ available: true, domain: 'bread.example.com' })
      }
      throw new Error('NETWORK_DOWN')
    })
    const wrapper = await mountPage()
    await fillReady(wrapper)
    await wrapper.get('.submitBtn').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('NETWORK_DOWN')
  })
})

describe('RegisterPage ownership proof', () => {
  async function mountWithSpace() {
    const wrapper = await mountPage()
    await wrapper.get('#spaceId').setValue('aastar.eth')
    await flushPromises()
    return wrapper
  }

  it('signs the timestamped message and includes the proof in the payload', async () => {
    // The signed message embeds the community name, so fill the form first and
    // only then request the proof (a later rename would invalidate it).
    const wrapper = await mountPage()
    await fillReady(wrapper)
    await wrapper.get('.ownershipBtn').trigger('click')
    await flushPromises()

    expect(authState.signMessage).toHaveBeenCalledTimes(1)
    const [address, message] = authState.signMessage.mock.calls[0] as [string, string]
    expect(address).toBe(authState.address)
    expect(message).toMatch(/^myvote:register:bread\.example\.com:\d+$/)
    expect(wrapper.text()).toContain('OWNERSHIP_VERIFIED')

    await wrapper.get('.submitBtn').trigger('click')
    await flushPromises()

    const body = lastBody()
    expect(body.adminAddress).toBe(authState.address)
    expect(body.adminSignature).toBe('0xsig')
    expect(typeof body.adminTimestamp).toBe('number')
  })

  it('connects first when no session is active', async () => {
    authState.connected = false
    const wrapper = await mountWithSpace()
    await wrapper.get('.ownershipBtn').trigger('click')
    await flushPromises()

    expect(authState.connect).toHaveBeenCalledTimes(1)
    expect(authState.signMessage).toHaveBeenCalledTimes(1)
  })

  it('errors when no address is available after connecting', async () => {
    authState.connected = false
    authState.address = null
    const wrapper = await mountWithSpace()
    await wrapper.get('.ownershipBtn').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('NO_ACCOUNT')
    expect(authState.signMessage).not.toHaveBeenCalled()
  })

  it('reports a rejected signature', async () => {
    authState.signMessage.mockRejectedValueOnce(new Error('USER_REJECTED'))
    const wrapper = await mountWithSpace()
    await wrapper.get('.ownershipBtn').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('USER_REJECTED')
    expect(wrapper.text()).not.toContain('OWNERSHIP_VERIFIED')
  })

  it('drops the proof when the name changes (the domain is part of the message)', async () => {
    const wrapper = await mountWithSpace()
    await wrapper.get('.ownershipBtn').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('OWNERSHIP_VERIFIED')

    await fillReady(wrapper)
    await wrapper.get('.submitBtn').trigger('click')
    await flushPromises()

    expect(lastBody()).not.toHaveProperty('adminSignature')
  })
})
