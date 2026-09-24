import { describe, expect, it } from 'vitest'

import { sxVoteBlock } from './eligibility'

const base = { state: 'active', start: 1000, maxEnd: 2000, hasAuthenticator: true }

describe('sxVoteBlock', () => {
  it('allows a vote inside the window', () => {
    expect(sxVoteBlock(base, 1500)).toBeNull()
  })

  it('blocks a closed proposal', () => {
    expect(sxVoteBlock({ ...base, state: 'CLOSED' }, 1500)).toBe('closed')
  })

  it('blocks before the start and after max_end', () => {
    expect(sxVoteBlock(base, 999)).toBe('not-started')
    expect(sxVoteBlock({ ...base, state: 'pending' }, 2001)).toBe('closed')
  })

  it('blocks when the space has no authenticator', () => {
    expect(sxVoteBlock({ ...base, hasAuthenticator: false }, 1500)).toBe('no-authenticator')
  })
})
