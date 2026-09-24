import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '../lib/errors'

// Unmount between tests so a previous wrapper cannot react to the shared mocks.
enableAutoUnmount(afterEach)

const { castVote, fetchProposal, signTypedData, fetchSxProposal, sxCastVote } = vi.hoisted(() => ({
  castVote: vi.fn(),
  fetchProposal: vi.fn(),
  signTypedData: vi.fn(),
  fetchSxProposal: vi.fn(),
  sxCastVote: vi.fn()
}))

vi.mock('../lib/voteBackend', () => ({
  activeVoteBackend: { castVote: (...args: unknown[]) => castVote(...args) }
}))

vi.mock('../lib/graphql', () => ({
  fetchProposal: (...args: unknown[]) => fetchProposal(...args)
}))

// Keep the real buildSxVoteRequest; stub only the network fetch.
vi.mock('../lib/sx/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/sx/api')>()
  return { ...actual, fetchSxProposal: (...args: unknown[]) => fetchSxProposal(...args) }
})

vi.mock('../lib/sx/provider', () => ({
  createSxBackendFromEip1193: () => ({
    id: 'snapshot-x-evm',
    castVote: (...args: unknown[]) => sxCastVote(...args)
  })
}))

const authState = vi.hoisted(() => ({
  providerId: 'email',
  user: { displayName: 'alice@example.com' } as { address?: string; displayName?: string }
}))

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    activeProviderId: { value: authState.providerId },
    isConnected: { value: true },
    user: { value: authState.user },
    provider: { value: { signTypedData } },
    connect: vi.fn()
  })
}))

const routeState = vi.hoisted(() => ({
  params: { id: '0xprop' } as Record<string, string>,
  query: {} as Record<string, unknown>
}))

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' }
}))

const ProposalPage = (await import('./ProposalPage.vue')).default

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      emailSigningUnsupported: 'EMAIL_CANNOT_SIGN',
      errVoteClockSkew: 'CLOCK_SKEW:{detail}',
      errVoteRejected: 'HUB_REJECTED:{status}:{detail}',
      errSxVoteClosed: 'SX_VOTE_CLOSED',
      voteError: 'Vote failed',
      submitVote: 'Submit vote',
      voteChoice: 'Choose an option',
      loading: 'Loading…',
      sxOnchain: 'ONCHAIN',
      sxUnknownNetwork: 'SX_UNKNOWN_NETWORK',
      noWallet: 'NO_WALLET',
      noAccount: 'NO_ACCOUNT'
    }
  }
})

const SX_SPACE = '0x03C7431e14F7b759Aa44398AD7901e6053c197Bf'

function proposal() {
  return {
    id: '0xprop',
    title: 'Test',
    state: 'active',
    author: '0x1111111111111111111111111111111111111111',
    start: 1700000000,
    end: 1800000000,
    body: '',
    choices: ['A', 'B'],
    scores: [1, 2],
    scores_total: 3,
    votes: 2,
    type: 'single-choice',
    space: { id: 'aastar.eth', name: 'AAStar' }
  }
}

function sxProposal() {
  return {
    id: SX_SPACE + '/12',
    proposalId: 12,
    network: 'optimism',
    title: 'SX Title',
    body: '',
    choices: ['For', 'Against'],
    state: 'active',
    snapshot: 125246602,
    start: 1700000000,
    end: 1800000000,
    maxEnd: 1900000000,
    voteCount: 3,
    type: 'basic',
    scores: [3, 0],
    scoresTotal: 3,
    strategies: [{ index: 0, address: '0x34f0AfFF5A739bBf3E285615F50e40ddAaf2A829', params: '0x' }],
    space: {
      id: SX_SPACE,
      authenticators: ['0x5f9B7D78c9a37a439D78f801E0E339C6E711e260'],
      strategies: [{ index: 0, address: '0x34f0AfFF5A739bBf3E285615F50e40ddAaf2A829', params: '0x' }]
    }
  }
}

function resetRoute() {
  routeState.params = { id: '0xprop' }
  routeState.query = {}
}

async function mountAndVote() {
  const wrapper = mount(ProposalPage, { global: { plugins: [i18n] } })
  await flushPromises()
  await wrapper.find('.choiceButton').trigger('click')
  await wrapper.find('.submit').trigger('click')
  await flushPromises()
  return wrapper
}

afterEach(() => {
  vi.resetAllMocks()
  resetRoute()
})

describe('ProposalPage vote errors', () => {
  it('says email cannot sign, and never reaches the vote backend', async () => {
    authState.providerId = 'email'
    authState.user = { displayName: 'alice@example.com' }
    fetchProposal.mockResolvedValue({ proposal: proposal() })

    const wrapper = await mountAndVote()

    expect(wrapper.text()).toContain('EMAIL_CANNOT_SIGN')
    expect(signTypedData).not.toHaveBeenCalled()
    expect(castVote).not.toHaveBeenCalled()
  })

  it('renders a coded hub rejection in the active locale, not the raw fallback', async () => {
    authState.providerId = 'wallet'
    authState.user = { address: '0x1111111111111111111111111111111111111111' }
    fetchProposal.mockResolvedValue({ proposal: proposal() })
    castVote.mockRejectedValueOnce(
      new AppError('voteRejected', '中文兜底', { status: 400, detail: 'no voting power' })
    )

    const wrapper = await mountAndVote()

    expect(wrapper.text()).toContain('HUB_REJECTED:400:no voting power')
    expect(wrapper.text()).not.toContain('中文兜底')
  })

  it('disables submit on a closed off-chain proposal', async () => {
    authState.providerId = 'wallet'
    authState.user = { address: '0x1111111111111111111111111111111111111111' }
    fetchProposal.mockResolvedValue({ proposal: { ...proposal(), state: 'closed' } })

    const wrapper = mount(ProposalPage, { global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.find('.choiceButton').trigger('click')

    expect(wrapper.find('.submit').attributes('disabled')).toBeDefined()
    expect(castVote).not.toHaveBeenCalled()
  })
})

describe('ProposalPage Snapshot X', () => {
  it('reads an SX proposal from the indexer and shows the on-chain badge', async () => {
    routeState.params = { id: '12' }
    routeState.query = { space: SX_SPACE }
    fetchSxProposal.mockResolvedValue(sxProposal())

    const wrapper = mount(ProposalPage, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(wrapper.text()).toContain('SX Title')
    expect(wrapper.text()).toContain('ONCHAIN')
    // Results render from the indexed scores (3 / 3 = 100%).
    expect(wrapper.text()).toContain('100.0%')
    expect(fetchSxProposal).toHaveBeenCalledWith(expect.any(String), SX_SPACE + '/12')
    // The off-chain Hub must not be consulted for an SX space.
    expect(fetchProposal).not.toHaveBeenCalled()
  })

  it('votes on-chain through the SX backend with the indexed authenticator', async () => {
    routeState.params = { id: '12' }
    routeState.query = { space: SX_SPACE }
    authState.providerId = 'wallet'
    authState.user = { address: '0x1111111111111111111111111111111111111111' }
    fetchSxProposal.mockResolvedValue(sxProposal())
    sxCastVote.mockResolvedValue({ id: 'sx-receipt' })
    ;(window as unknown as { ethereum?: unknown }).ethereum = { request: vi.fn() }

    await mountAndVote()

    expect(sxCastVote).toHaveBeenCalledTimes(1)
    const [request] = sxCastVote.mock.calls[0] as [Record<string, unknown>]
    expect(request).toMatchObject({
      space: SX_SPACE,
      proposal: 12,
      choice: 1,
      authenticator: '0x5f9B7D78c9a37a439D78f801E0E339C6E711e260'
    })
    // The off-chain backend must not be used for an SX space.
    expect(castVote).not.toHaveBeenCalled()
  })

  it('disables submit on a closed on-chain proposal', async () => {
    routeState.params = { id: '12' }
    routeState.query = { space: SX_SPACE }
    fetchSxProposal.mockResolvedValue({ ...sxProposal(), state: 'closed' })

    const wrapper = mount(ProposalPage, { global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.find('.choiceButton').trigger('click')

    expect(wrapper.find('.submit').attributes('disabled')).toBeDefined()
  })

  it('blocks an out-of-window on-chain vote before signing, with a translated reason', async () => {
    routeState.params = { id: '12' }
    routeState.query = { space: SX_SPACE }
    authState.providerId = 'wallet'
    authState.user = { address: '0x1111111111111111111111111111111111111111' }
    // Indexed state still says active, but the voting window has passed.
    fetchSxProposal.mockResolvedValue({ ...sxProposal(), state: 'active', maxEnd: 1700000001 })
    ;(window as unknown as { ethereum?: unknown }).ethereum = { request: vi.fn() }

    const wrapper = await mountAndVote()

    expect(wrapper.text()).toContain('SX_VOTE_CLOSED')
    expect(sxCastVote).not.toHaveBeenCalled()
  })

  it('reports a missing wallet instead of attempting an on-chain vote', async () => {
    routeState.params = { id: '12' }
    routeState.query = { space: SX_SPACE }
    authState.providerId = 'wallet'
    authState.user = { address: '0x1111111111111111111111111111111111111111' }
    fetchSxProposal.mockResolvedValue(sxProposal())
    delete (window as unknown as { ethereum?: unknown }).ethereum

    const wrapper = await mountAndVote()

    expect(wrapper.text()).toContain('NO_WALLET')
    expect(sxCastVote).not.toHaveBeenCalled()
  })
})
