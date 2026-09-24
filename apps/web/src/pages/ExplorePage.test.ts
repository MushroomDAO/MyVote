import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { fetchSpaces, fetchSxSpaces } = vi.hoisted(() => ({
  fetchSpaces: vi.fn(),
  fetchSxSpaces: vi.fn()
}))
const { push } = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('../lib/graphql', () => ({
  fetchSpaces: (...args: unknown[]) => fetchSpaces(...args)
}))

vi.mock('../lib/sx/api', () => ({
  fetchSxSpaces: (...args: unknown[]) => fetchSxSpaces(...args)
}))

// Keep the cache a no-op so tests do not share state.
vi.mock('../lib/cache', () => ({
  cacheGet: () => null,
  cacheSet: () => {},
  cacheDelete: () => {},
  scopedCacheKey: (namespace: string) => namespace
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' }
}))

const ExplorePage = (await import('./ExplorePage.vue')).default

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      explore: 'Explore',
      spaces: 'Spaces',
      loading: 'Loading…',
      empty: 'No data',
      loadMore: 'Load more',
      refresh: 'Refresh',
      retry: 'Retry',
      cached: 'cached',
      openSxPlaceholder: 'SX address',
      openSxButton: 'Open',
      openSxInvalid: 'INVALID_SX',
      onchainSpaces: 'On-chain spaces'
    }
  }
})

const SX = '0x03C7431e14F7b759Aa44398AD7901e6053c197Bf'

async function mountExplore() {
  fetchSpaces.mockResolvedValue({ spaces: [] })
  fetchSxSpaces.mockResolvedValue([])
  const wrapper = mount(ExplorePage, { global: { plugins: [i18n] } })
  await flushPromises()
  return wrapper
}

afterEach(() => {
  vi.resetAllMocks()
})

describe('ExplorePage on-chain entry', () => {
  it('rejects a non-SX address and does not navigate', async () => {
    const wrapper = await mountExplore()

    await wrapper.find('.sxInput').setValue('yam.eth')
    await wrapper.find('.sxBtn').trigger('click')

    expect(wrapper.text()).toContain('INVALID_SX')
    expect(push).not.toHaveBeenCalled()
  })

  it('navigates to the SX space when a contract address is entered', async () => {
    const wrapper = await mountExplore()

    await wrapper.find('.sxInput').setValue(SX)
    await wrapper.find('.sxBtn').trigger('click')

    expect(push).toHaveBeenCalledWith('/space/' + SX)
  })

  it('lists recently created on-chain spaces with their network', async () => {
    fetchSpaces.mockResolvedValue({ spaces: [] })
    fetchSxSpaces.mockResolvedValue([{ id: SX, name: 'Ryu0x167 Space Command', network: 'optimism' }])

    const wrapper = mount(ExplorePage, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(wrapper.text()).toContain('On-chain spaces')
    expect(wrapper.text()).toContain('Ryu0x167 Space Command')
    expect(wrapper.text()).toContain('Optimism')
  })
})
