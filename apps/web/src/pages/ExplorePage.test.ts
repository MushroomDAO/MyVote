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
      onchainSpaces: 'On-chain spaces',
      error: 'SX_ERROR'
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

describe('ExplorePage pagination lookahead', () => {
  const spaces = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ id: 's' + i, name: 'S' + i }))

  it('asks for one extra row and hides Load more on an exact multiple', async () => {
    fetchSpaces.mockResolvedValueOnce({ spaces: spaces(30) })
    fetchSxSpaces.mockResolvedValue([])
    const wrapper = mount(ExplorePage, { global: { plugins: [i18n] } })
    await flushPromises()

    const params = fetchSpaces.mock.calls[0]![1] as { first: number }
    expect(params.first).toBe(31)
    expect(wrapper.findAll('.item')).toHaveLength(30)
    expect(wrapper.find('.moreBtn').exists()).toBe(false)
  })

  it('shows Load more when the lookahead row comes back', async () => {
    fetchSpaces.mockResolvedValueOnce({ spaces: spaces(31) })
    fetchSxSpaces.mockResolvedValue([])
    const wrapper = mount(ExplorePage, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(wrapper.findAll('.item')).toHaveLength(30)
    expect(wrapper.find('.moreBtn').exists()).toBe(true)
  })
})

describe('ExplorePage on-chain pagination', () => {
  const sxSpaces = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: '0x' + i,
      name: 'S' + i,
      network: 'optimism'
    }))

  it('asks for one extra row and hides Load more on an exact multiple', async () => {
    fetchSpaces.mockResolvedValue({ spaces: [] })
    fetchSxSpaces.mockResolvedValueOnce(sxSpaces(6))
    const wrapper = mount(ExplorePage, { global: { plugins: [i18n] } })
    await flushPromises()

    const options = fetchSxSpaces.mock.calls[0]![1] as { first: number; skip: number }
    expect(options.first).toBe(7)
    expect(options.skip).toBe(0)
    expect(wrapper.findAll('.onchainCard .item')).toHaveLength(6)
    expect(wrapper.find('.onchainCard .moreBtn').exists()).toBe(false)
  })

  it('shows Load more and renders only a page when the lookahead arrives', async () => {
    fetchSpaces.mockResolvedValue({ spaces: [] })
    fetchSxSpaces.mockResolvedValueOnce(sxSpaces(7))
    const wrapper = mount(ExplorePage, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(wrapper.findAll('.onchainCard .item')).toHaveLength(6)
    expect(wrapper.find('.onchainCard .moreBtn').exists()).toBe(true)
  })

  it('appends the next page on Load more', async () => {
    fetchSpaces.mockResolvedValue({ spaces: [] })
    fetchSxSpaces
      .mockResolvedValueOnce(sxSpaces(7))
      .mockResolvedValueOnce([{ id: '0xextra', name: 'Extra', network: 'optimism' }])
    const wrapper = mount(ExplorePage, { global: { plugins: [i18n] } })
    await flushPromises()

    await wrapper.get('.onchainCard .moreBtn').trigger('click')
    await flushPromises()

    const second = fetchSxSpaces.mock.calls[1]![1] as { skip: number }
    expect(second.skip).toBe(6)
    expect(wrapper.findAll('.onchainCard .item')).toHaveLength(7)
    expect(wrapper.get('.onchainCard').text()).toContain('Extra')
  })
})

describe('ExplorePage on-chain failure', () => {
  it('shows a hint and retries when the on-chain list fails', async () => {
    fetchSpaces.mockResolvedValue({ spaces: [] })
    fetchSxSpaces
      .mockRejectedValueOnce(new Error('SX_DOWN'))
      .mockResolvedValueOnce([{ id: SX, name: 'Ryu0x167', network: 'optimism' }])

    const wrapper = mount(ExplorePage, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(wrapper.get('.onchainCard').text()).toContain('SX_ERROR')
    await wrapper.get('.onchainCard .retryBtn').trigger('click')
    await flushPromises()

    expect(wrapper.get('.onchainCard').text()).toContain('Ryu0x167')
  })
})

describe('ExplorePage read cancellation', () => {
  it('refreshes the on-chain list along with the off-chain one', async () => {
    fetchSpaces.mockResolvedValue({ spaces: [] })
    fetchSxSpaces.mockResolvedValue([])
    const wrapper = mount(ExplorePage, { global: { plugins: [i18n] } })
    await flushPromises()
    expect(fetchSxSpaces).toHaveBeenCalledTimes(1)

    await wrapper.find('.refreshBtn').trigger('click')
    await flushPromises()

    expect(fetchSxSpaces).toHaveBeenCalledTimes(2)
    expect(fetchSxSpaces.mock.lastCall![1]).toMatchObject({ skip: 0 })
  })

  it('keeps the on-chain read alive across off-chain pagination', async () => {
    let resolveSx!: (value: unknown) => void
    fetchSxSpaces.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSx = resolve
      })
    )
    // A full lookahead page, so the off-chain Load-more button shows.
    fetchSpaces.mockResolvedValue({
      spaces: Array.from({ length: 31 }, (_, i) => ({ id: 's' + i, name: 'S' + i }))
    })

    const wrapper = mount(ExplorePage, { global: { plugins: [i18n] } })
    await flushPromises()

    const sxSignal = (fetchSxSpaces.mock.calls[0]![1] as { signal: AbortSignal }).signal
    expect(sxSignal.aborted).toBe(false)

    await wrapper.get('.moreBtn').trigger('click')
    await flushPromises()

    // Off-chain pagination uses the off-chain guard, not the on-chain one.
    expect(sxSignal.aborted).toBe(false)

    resolveSx([{ id: SX, name: 'N', network: 'optimism' }])
    await flushPromises()
  })

  it('aborts both in-flight reads on unmount', async () => {
    fetchSpaces.mockReturnValueOnce(new Promise(() => {}))
    fetchSxSpaces.mockReturnValueOnce(new Promise(() => {}))

    const wrapper = mount(ExplorePage, { global: { plugins: [i18n] } })
    await flushPromises()

    const offchainSignal = (fetchSpaces.mock.calls[0]![1] as { signal: AbortSignal }).signal
    const sxSignal = (fetchSxSpaces.mock.calls[0]![1] as { signal: AbortSignal }).signal

    wrapper.unmount()

    expect(offchainSignal.aborted).toBe(true)
    expect(sxSignal.aborted).toBe(true)
  })
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
