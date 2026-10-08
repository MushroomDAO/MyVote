import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import { currentNetworkId } from '../lib/networks'
import { messages } from '../i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Previously-mounted wrappers stay reactive to the shared route mock, so an
// earlier test's component would react to this test's navigation too.
enableAutoUnmount(afterEach)

const { fetchSpaceWithProposals, fetchSxSpace, fetchSxProposals, exportCommunity, downloadCommunityExport } = vi.hoisted(() => ({
  fetchSpaceWithProposals: vi.fn(),
  fetchSxSpace: vi.fn(),
  fetchSxProposals: vi.fn(),
  exportCommunity: vi.fn(),
  downloadCommunityExport: vi.fn()
}))

vi.mock('../lib/graphql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/graphql')>()
  return {
    ...actual,
    fetchSpaceWithProposals
  }
})

vi.mock('../lib/communityExport', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/communityExport')>(),
  exportCommunity,
  downloadCommunityExport
}))

vi.mock('../lib/sx/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/sx/api')>(),
  fetchSxSpace: (...args: unknown[]) => fetchSxSpace(...args),
  fetchSxProposals: (...args: unknown[]) => fetchSxProposals(...args)
}))

// A reactive route so changing the id fires the component's watch(spaceId).
vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  const route = reactive({ params: { id: 'space-a' } })
  return {
    useRoute: () => route,
    RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' }
  }
})

const SpacePage = (await import('./SpacePage.vue')).default
const { useRoute } = await import('vue-router')
const route = useRoute() as unknown as { params: { id: string } }

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      ...messages.en,
      back: 'Back',
      loading: 'Loading…',
      empty: 'No data',
      proposals: 'Proposals',
      loadMore: 'Load more',
      sxOnchain: 'ONCHAIN',
      network: 'Network',
      retry: 'Retry',
      emptyFiltered: 'EMPTY_FILTERED',
      filterAll: 'ALL',
      filterActive: 'ACTIVE',
      filterClosed: 'CLOSED',
      demoSpaceName: 'AAStar',
      demoSpaceAbout: 'AAStar Demo Space'
    }
  }
})

function deferred() {
  let resolve!: (value: unknown) => void
  const promise = new Promise<unknown>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function spaceResult(id: string, name: string) {
  return { space: { id, name }, proposals: [] }
}

function sxSpace(id: string, name: string) {
  return {
    id,
    name,
    about: null,
    network: 'optimism',
    authenticators: [],
    vpDecimals: 0,
    proposalCount: 12,
    strategies: []
  }
}

afterEach(() => {
  vi.resetAllMocks()
})

describe('SpacePage stale-response guard', () => {
  it('keeps the newest space when an older request resolves last', async () => {
    const stale = deferred()
    const fresh = deferred()
    fetchSpaceWithProposals
      .mockReturnValueOnce(stale.promise) // mount -> space-a
      .mockReturnValueOnce(fresh.promise) // watch -> space-b

    route.params.id = 'space-a'
    const wrapper = mount(SpacePage, { global: { plugins: [i18n] } })
    await nextTick()

    // Navigate to another space while A is still in flight.
    route.params.id = 'space-b'
    await nextTick()

    // B resolves first…
    fresh.resolve(spaceResult('space-b', 'Space B'))
    await flushPromises()
    // …then the stale A resolves and must NOT overwrite B.
    stale.resolve(spaceResult('space-a', 'Space A'))
    await flushPromises()

    expect(wrapper.text()).toContain('Space B')
    expect(wrapper.text()).not.toContain('Space A')
  })

  it('applies the same guard to concurrent SX reads', async () => {
    const SX_A = '0x1111111111111111111111111111111111111111'
    const SX_B = '0x2222222222222222222222222222222222222222'

    const staleSpace = deferred()
    const freshSpace = deferred()
    fetchSxSpace
      .mockReturnValueOnce(staleSpace.promise) // mount -> SX_A
      .mockReturnValueOnce(freshSpace.promise) // watch -> SX_B
    fetchSxProposals.mockResolvedValue([])

    route.params.id = SX_A
    const wrapper = mount(SpacePage, { global: { plugins: [i18n] } })
    await nextTick()

    route.params.id = SX_B
    await nextTick()

    // The two SX reads run in parallel (Promise.all); the guard is what keeps
    // the slower older pair from overwriting the newer space.
    freshSpace.resolve(sxSpace(SX_B, 'SX B'))
    await flushPromises()
    staleSpace.resolve(sxSpace(SX_A, 'SX A'))
    await flushPromises()

    // Diagnostic: confirm both SX loads actually started.
    expect(fetchSxSpace).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('SX B')
    expect(wrapper.text()).not.toContain('SX A')
    // On-chain detail: badge + network label + proposal count.
    expect(wrapper.text()).toContain('ONCHAIN')
    expect(wrapper.text()).toContain('Optimism')
    // It read on-chain, not from the off-chain Hub.
    expect(fetchSpaceWithProposals).not.toHaveBeenCalled()
  })
})
describe('SpacePage read cancellation', () => {
  it('aborts the superseded request when the space changes', async () => {
    const stale = deferred()
    fetchSpaceWithProposals
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(spaceResult('space-b', 'Space B'))

    route.params.id = 'space-a'
    mount(SpacePage, { global: { plugins: [i18n] } })
    await nextTick()

    const { signal } = fetchSpaceWithProposals.mock.calls[0]![1] as { signal: AbortSignal }
    expect(signal.aborted).toBe(false)

    route.params.id = 'space-b'
    await nextTick()

    expect(signal.aborted).toBe(true)
    stale.resolve(spaceResult('space-a', 'Space A'))
    await flushPromises()
  })

  it('shares one signal between the concurrent SX reads', async () => {
    const SX_A = '0x1111111111111111111111111111111111111111'
    fetchSxSpace.mockResolvedValue(sxSpace(SX_A, 'SX A'))
    fetchSxProposals.mockResolvedValue([])
    route.params.id = SX_A
    mount(SpacePage, { global: { plugins: [i18n] } })
    await flushPromises()

    const spaceOptions = fetchSxSpace.mock.calls[0]![2] as { signal: AbortSignal }
    const proposalOptions = fetchSxProposals.mock.calls[0]![2] as { signal: AbortSignal }
    expect(spaceOptions.signal).toBeInstanceOf(AbortSignal)
    expect(proposalOptions.signal).toBe(spaceOptions.signal)
    expect(spaceOptions.signal.aborted).toBe(false)
  })

  it('aborts the in-flight read on unmount', async () => {
    const pending = deferred()
    fetchSpaceWithProposals.mockReturnValueOnce(pending.promise)
    route.params.id = 'space-a'
    const wrapper = mount(SpacePage, { global: { plugins: [i18n] } })
    await nextTick()

    const { signal } = fetchSpaceWithProposals.mock.calls[0]![1] as { signal: AbortSignal }
    expect(signal.aborted).toBe(false)

    wrapper.unmount()

    expect(signal.aborted).toBe(true)
    pending.resolve(spaceResult('space-a', 'Space A'))
    await flushPromises()
  })
})

describe('SpacePage pagination lookahead', () => {
  function proposals(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: 'p' + i,
      title: 'P' + i,
      created: 1700000000 + i,
      state: 'active'
    }))
  }

  it('asks for one extra row as the lookahead', async () => {
    fetchSpaceWithProposals.mockResolvedValueOnce({
      space: { id: 'space-a', name: 'A' },
      proposals: proposals(5)
    })
    route.params.id = 'space-a'
    mount(SpacePage, { global: { plugins: [i18n] } })
    await flushPromises()

    const params = fetchSpaceWithProposals.mock.calls[0]![1] as { first: number }
    expect(params.first).toBe(21)
  })

  it('hides Load more on an exact multiple of the page size', async () => {
    fetchSpaceWithProposals.mockResolvedValueOnce({
      space: { id: 'space-a', name: 'A' },
      proposals: proposals(20)
    })
    route.params.id = 'space-a'
    const wrapper = mount(SpacePage, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(wrapper.findAll('.item')).toHaveLength(20)
    expect(wrapper.find('.moreBtn').exists()).toBe(false)
  })

  it('shows Load more but renders only a page when the lookahead row arrives', async () => {
    fetchSpaceWithProposals.mockResolvedValueOnce({
      space: { id: 'space-a', name: 'A' },
      proposals: proposals(21)
    })
    route.params.id = 'space-a'
    const wrapper = mount(SpacePage, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(wrapper.findAll('.item')).toHaveLength(20)
    expect(wrapper.find('.moreBtn').exists()).toBe(true)
  })
})

describe('SpacePage proposal state filter', () => {
  it('sends no state predicate by default', async () => {
    fetchSpaceWithProposals.mockResolvedValueOnce(spaceResult('space-a', 'A'))
    route.params.id = 'space-a'
    mount(SpacePage, { global: { plugins: [i18n] } })
    await flushPromises()

    const params = fetchSpaceWithProposals.mock.calls[0]![1] as { state?: string }
    expect(params.state).toBeUndefined()
  })

  it('renders the three filters and refetches with the selected state', async () => {
    fetchSpaceWithProposals.mockResolvedValue(spaceResult('space-a', 'A'))
    route.params.id = 'space-a'
    const wrapper = mount(SpacePage, { global: { plugins: [i18n] } })
    await flushPromises()

    const buttons = wrapper.findAll('.filterBtn')
    expect(buttons.map((b) => b.text())).toEqual(['ALL', 'ACTIVE', 'CLOSED'])
    expect(buttons[0]!.classes()).toContain('isActive')

    await buttons[1]!.trigger('click')
    await flushPromises()

    const last = fetchSpaceWithProposals.mock.lastCall![1] as { state?: string; skip: number }
    expect(last.state).toBe('active')
    expect(last.skip).toBe(0)
  })

  it('forwards the filter to the SX read as well', async () => {
    const SX_A = '0x1111111111111111111111111111111111111111'
    fetchSxSpace.mockResolvedValue(sxSpace(SX_A, 'SX A'))
    fetchSxProposals.mockResolvedValue([])
    route.params.id = SX_A
    const wrapper = mount(SpacePage, { global: { plugins: [i18n] } })
    await flushPromises()

    await wrapper.findAll('.filterBtn')[2]!.trigger('click')
    await flushPromises()

    const options = fetchSxProposals.mock.lastCall![2] as { state?: string }
    expect(options.state).toBe('closed')
  })

  it('resets the filter when navigating to another space', async () => {
    fetchSpaceWithProposals.mockResolvedValue(spaceResult('space-a', 'A'))
    route.params.id = 'space-a'
    const wrapper = mount(SpacePage, { global: { plugins: [i18n] } })
    await flushPromises()

    await wrapper.findAll('.filterBtn')[2]!.trigger('click')
    await flushPromises()
    expect((fetchSpaceWithProposals.mock.lastCall![1] as { state?: string }).state).toBe('closed')

    route.params.id = 'space-b'
    await nextTick()
    await flushPromises()
    expect((fetchSpaceWithProposals.mock.lastCall![1] as { state?: string }).state).toBeUndefined()
  })

  it('explains an empty filtered result', async () => {
    fetchSpaceWithProposals.mockResolvedValue({
      space: { id: 'space-a', name: 'A' },
      proposals: []
    })
    route.params.id = 'space-a'
    const wrapper = mount(SpacePage, { global: { plugins: [i18n] } })
    await flushPromises()

    await wrapper.findAll('.filterBtn')[1]!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('EMPTY_FILTERED')
  })

  it('keeps the card and filters while a filter reload is in flight', async () => {
    let resolvePage!: (value: unknown) => void
    fetchSpaceWithProposals
      .mockResolvedValueOnce(spaceResult('space-a', 'A'))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePage = resolve
        })
      )
    route.params.id = 'space-a'
    const wrapper = mount(SpacePage, { global: { plugins: [i18n] } })
    await flushPromises()

    await wrapper.findAll('.filterBtn')[1]!.trigger('click')
    await nextTick()

    // The card (and its filters) stay; only the list shows loading.
    expect(wrapper.findAll('.filterBtn')).toHaveLength(3)
    expect(wrapper.find('.listLoading').exists()).toBe(true)

    resolvePage(spaceResult('space-a', 'A'))
    await flushPromises()

    expect(wrapper.find('.listLoading').exists()).toBe(false)
    expect(wrapper.findAll('.filterBtn')).toHaveLength(3)
  })

  it('issues a single reload when navigating away with a filter active', async () => {
    fetchSpaceWithProposals.mockResolvedValue(spaceResult('space-a', 'A'))
    route.params.id = 'space-a'
    const wrapper = mount(SpacePage, { global: { plugins: [i18n] } })
    await flushPromises()

    await wrapper.findAll('.filterBtn')[2]!.trigger('click')
    await flushPromises()
    const before = fetchSpaceWithProposals.mock.calls.length

    route.params.id = 'space-b'
    await nextTick()
    await flushPromises()

    // Resetting the filter triggers the reload; a second call would duplicate it.
    expect(fetchSpaceWithProposals.mock.calls.length).toBe(before + 1)
  })
})

describe('SpacePage error recovery', () => {
  it('offers a retry that refetches the space', async () => {
    fetchSpaceWithProposals
      .mockRejectedValueOnce(new Error('HUB_DOWN'))
      .mockResolvedValueOnce(spaceResult('space-a', 'Space A'))

    route.params.id = 'space-a'
    const wrapper = mount(SpacePage, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(wrapper.text()).toContain('HUB_DOWN')
    await wrapper.get('.retryBtn').trigger('click')
    await flushPromises()

    expect(fetchSpaceWithProposals).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Space A')
  })
})


describe('SpacePage community export', () => {
  const complete = { history: { proposals: { status: 'complete' }, records: [] } }
  async function showSpace() {
    route.params.id = 'space-a'
    fetchSpaceWithProposals.mockResolvedValue(spaceResult('space-a', 'A'))
    const wrapper = mount(SpacePage, { global: { plugins: [i18n] } })
    await flushPromises()
    return wrapper
  }

  it('exports all history from the resolved endpoint independently of filters and preserves the list', async () => {
    const wrapper = await showSpace()
    await wrapper.findAll('.filterBtn')[1]!.trigger('click')
    await flushPromises()
    exportCommunity.mockResolvedValue(complete)
    await wrapper.get('.exportBtn').trigger('click')
    await flushPromises()
    expect(exportCommunity).toHaveBeenCalledTimes(1)
    const options = exportCommunity.mock.calls[0]![0]
    expect(options.spaceId).toBe('space-a')
    expect(options.endpoint).toBe(fetchSpaceWithProposals.mock.lastCall![0])
    expect(options.state).toBeUndefined()
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(downloadCommunityExport).toHaveBeenCalledWith(complete)
    expect(wrapper.get('[role="status"]').text()).toContain('JSON downloaded')
    expect(wrapper.findAll('.filterBtn')[1]!.classes()).toContain('isActive')
  })

  it('disables duplicate export, announces progress, and cancels without downloading late results', async () => {
    const wrapper = await showSpace()
    const pending = deferred()
    exportCommunity.mockReturnValue(pending.promise)
    await wrapper.get('.exportBtn').trigger('click')
    await wrapper.get('.exportBtn').trigger('click')
    expect(exportCommunity).toHaveBeenCalledTimes(1)
    expect(wrapper.get('.exportBtn').attributes('disabled')).toBeDefined()
    const options = exportCommunity.mock.calls[0]![0]
    options.onProgress({ proposals: 12, votes: 34, requests: 5 })
    await nextTick()
    expect(wrapper.get('[role="status"]').text()).toContain('12 proposals and 34 vote records')
    await wrapper.get('.export .retryBtn').trigger('click')
    expect(options.signal.aborted).toBe(true)
    expect(wrapper.get('[role="status"]').text()).toContain('cancelled')
    pending.resolve(complete)
    await flushPromises()
    expect(downloadCommunityExport).not.toHaveBeenCalled()
  })

  it('cancels stale exports on route changes and unmount', async () => {
    const wrapper = await showSpace()
    const pending = deferred()
    exportCommunity.mockReturnValue(pending.promise)
    await wrapper.get('.exportBtn').trigger('click')
    const first = exportCommunity.mock.lastCall![0].signal
    route.params.id = 'space-b'
    fetchSpaceWithProposals.mockResolvedValue(spaceResult('space-b', 'B'))
    await nextTick()
    await flushPromises()
    expect(first.aborted).toBe(true)
    pending.resolve(complete)
    await flushPromises()
    expect(downloadCommunityExport).not.toHaveBeenCalled()
    exportCommunity.mockReturnValue(deferred().promise)
    await wrapper.get('.exportBtn').trigger('click')
    const second = exportCommunity.mock.lastCall![0].signal
    wrapper.unmount()
    expect(second.aborted).toBe(true)
  })

  it('cancels when the selected network changes', async () => {
    const wrapper = await showSpace()
    const initialNetwork = currentNetworkId.value
    const pending = deferred()
    exportCommunity.mockReturnValue(pending.promise)
    await wrapper.get('.exportBtn').trigger('click')
    const options = exportCommunity.mock.lastCall![0]
    currentNetworkId.value = initialNetwork === 'optimism' ? 'mainnet' : 'optimism'
    await nextTick()
    expect(options.signal.aborted).toBe(true)
    pending.resolve(complete)
    await flushPromises()
    expect(downloadCommunityExport).not.toHaveBeenCalled()
    wrapper.unmount()
    currentNetworkId.value = initialNetwork
  })

  it('announces partial exports and offers retry on failure without hiding community content', async () => {
    const wrapper = await showSpace()
    const partial = { history: { proposals: { status: 'partial' }, records: [] } }
    exportCommunity.mockResolvedValueOnce(partial).mockRejectedValueOnce(new Error('HTTP 500'))
    await wrapper.get('.exportBtn').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain('incomplete history')
    await wrapper.get('.exportBtn').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Export failed. Please retry.')
    expect(wrapper.get('h1').text()).toBe('A')
    expect(wrapper.get('.exportBtn').attributes('disabled')).toBeUndefined()
  })

  it('uses the classic fallback endpoint for export and subsequent proposal pages', async () => {
    route.params.id = 'fallback.eth'
    fetchSpaceWithProposals.mockResolvedValueOnce({ space: null, proposals: [] })
      .mockResolvedValue({ space: { id: 'fallback.eth', name: 'Fallback' }, proposals: [] })
    const wrapper = mount(SpacePage, { global: { plugins: [i18n] } })
    await flushPromises()
    const endpoint = fetchSpaceWithProposals.mock.lastCall![0]
    expect(endpoint).not.toBe(fetchSpaceWithProposals.mock.calls[0]![0])
    exportCommunity.mockResolvedValue(complete)
    await wrapper.get('.exportBtn').trigger('click')
    await flushPromises()
    expect(exportCommunity.mock.lastCall![0].endpoint).toBe(endpoint)
    await wrapper.findAll('.filterBtn')[1]!.trigger('click')
    await flushPromises()
    expect(fetchSpaceWithProposals.mock.lastCall![0]).toBe(endpoint)
  })

  it('uses the SX fallback endpoint and keeps export protocol routing independent of the list', async () => {
    const SX = '0x1111111111111111111111111111111111111111'
    route.params.id = SX
    fetchSxSpace.mockResolvedValueOnce(null).mockResolvedValue(sxSpace(SX, 'SX'))
    fetchSxProposals.mockResolvedValue([])
    const wrapper = mount(SpacePage, { global: { plugins: [i18n] } })
    await flushPromises()
    const endpoint = fetchSxSpace.mock.lastCall![0]
    expect(endpoint).not.toBe(fetchSxSpace.mock.calls[0]![0])
    exportCommunity.mockResolvedValue(complete)
    await wrapper.get('.exportBtn').trigger('click')
    await flushPromises()
    expect(exportCommunity.mock.lastCall![0]).toMatchObject({ spaceId: SX, endpoint })
  })

  it('does not export synthetic detail-page metadata when both Hubs lack the space', async () => {
    route.params.id = 'aastar.eth'
    fetchSpaceWithProposals.mockResolvedValue({ space: null, proposals: [] })
    const wrapper = mount(SpacePage, { global: { plugins: [i18n] } })
    await flushPromises()
    expect(wrapper.get('.exportBtn').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('unavailable from the upstream API')
    await wrapper.get('.exportBtn').trigger('click')
    expect(exportCommunity).not.toHaveBeenCalled()
  })
})
