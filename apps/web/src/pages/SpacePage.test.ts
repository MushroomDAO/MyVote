import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const { fetchSpaceWithProposals } = vi.hoisted(() => ({
  fetchSpaceWithProposals: vi.fn()
}))

vi.mock('../lib/graphql', () => ({ fetchSpaceWithProposals }))

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
      loadMore: 'Load more'
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
})
