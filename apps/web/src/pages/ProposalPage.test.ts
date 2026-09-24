import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it, vi } from 'vitest'

const castVote = vi.fn()
const fetchProposal = vi.fn()

vi.mock('../lib/voteBackend', () => ({
  activeVoteBackend: { castVote: (...args: unknown[]) => castVote(...args) }
}))

vi.mock('../lib/graphql', () => ({
  fetchProposal: (...args: unknown[]) => fetchProposal(...args)
}))

const signTypedData = vi.fn()
vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    activeProviderId: { value: 'email' },
    isConnected: { value: true },
    user: { value: { displayName: 'alice@example.com' } },
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

describe('ProposalPage email sign-in', () => {
  it('says email cannot sign, and never reaches the vote backend', async () => {
    fetchProposal.mockResolvedValue({ proposal: proposal() })

    const wrapper = mount(ProposalPage, { global: { plugins: [i18n] } })
    await flushPromises()

    await wrapper.find('.choiceButton').trigger('click')
    await wrapper.find('.submit').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('EMAIL_CANNOT_SIGN')
    // The guard runs before signing/submitting: no key, no network, no vote.
    expect(signTypedData).not.toHaveBeenCalled()
    expect(castVote).not.toHaveBeenCalled()
  })
})
