import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it, vi } from 'vitest'

import { AppError } from '../lib/errors'

const { castVote, fetchProposal, signTypedData } = vi.hoisted(() => ({
  castVote: vi.fn(),
  fetchProposal: vi.fn(),
  signTypedData: vi.fn()
}))

vi.mock('../lib/voteBackend', () => ({
  activeVoteBackend: { castVote: (...args: unknown[]) => castVote(...args) }
}))

vi.mock('../lib/graphql', () => ({
  fetchProposal: (...args: unknown[]) => fetchProposal(...args)
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

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '0xprop' } }),
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
      voteError: 'Vote failed',
      submitVote: 'Submit vote',
      voteChoice: 'Choose an option',
      loading: 'Loading…'
    }
  }
})

function proposal() {
  return {
    id: '0xprop',
    title: 'Test',
    state: 'open',
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

async function mountAndVote() {
  fetchProposal.mockResolvedValue({ proposal: proposal() })
  const wrapper = mount(ProposalPage, { global: { plugins: [i18n] } })
  await flushPromises()

  await wrapper.find('.choiceButton').trigger('click')
  await wrapper.find('.submit').trigger('click')
  await flushPromises()

  return wrapper
}

describe('ProposalPage vote errors', () => {
  it('says email cannot sign, and never reaches the vote backend', async () => {
    authState.providerId = 'email'
    authState.user = { displayName: 'alice@example.com' }

    const wrapper = await mountAndVote()

    expect(wrapper.text()).toContain('EMAIL_CANNOT_SIGN')
    // The guard runs before signing/submitting: no key, no network, no vote.
    expect(signTypedData).not.toHaveBeenCalled()
    expect(castVote).not.toHaveBeenCalled()
  })

  it('renders a coded hub rejection in the active locale, not the raw fallback', async () => {
    authState.providerId = 'wallet'
    authState.user = { address: '0x1111111111111111111111111111111111111111' }
    castVote.mockRejectedValueOnce(
      new AppError('voteRejected', '中文兜底', { status: 400, detail: 'no voting power' })
    )

    const wrapper = await mountAndVote()

    expect(wrapper.text()).toContain('HUB_REJECTED:400:no voting power')
    // The hardcoded Chinese fallback must not leak into an English UI.
    expect(wrapper.text()).not.toContain('中文兜底')
  })
})
