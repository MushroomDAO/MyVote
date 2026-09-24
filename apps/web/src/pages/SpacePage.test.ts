import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Previously-mounted wrappers stay reactive to the shared route mock, so an
// earlier test's component would react to this test's navigation too.
enableAutoUnmount(afterEach)

const { fetchSpaceWithProposals, fetchSxSpace, fetchSxProposals } = vi.hoisted(() => ({
  fetchSpaceWithProposals: vi.fn(),
  fetchSxSpace: vi.fn(),
  fetchSxProposals: vi.fn()
}))

vi.mock('../lib/graphql', () => ({ fetchSpaceWithProposals }))

vi.mock('../lib/sx/api', () => ({
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
      back: 'Back',
      loading: 'Loading…',
      empty: 'No data',
      proposals: 'Proposals',
      loadMore: 'Load more',
      sxOnchain: 'ONCHAIN',
      network: 'Network',
      retry: 'Retry',
      filterAll: 'ALL',
      filterActive: 'ACTIVE',
      filterClosed: 'CLOSED'
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
