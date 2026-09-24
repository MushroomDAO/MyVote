import { describe, expect, it } from 'vitest'

import {
  buildOwnershipMessage,
  isFreshTimestamp,
  ownershipVerdict,
  OWNERSHIP_MAX_AGE_MS
} from './ownership'

describe('buildOwnershipMessage', () => {
  it('interpolates domain and timestamp into the exact signed message', () => {
    expect(buildOwnershipMessage('bread.forest.mushroom.cv', 1700000000)).toBe(
      'myvote:register:bread.forest.mushroom.cv:1700000000'
    )
  })
})

describe('isFreshTimestamp', () => {
  const now = 1_700_000_000_000

  it('accepts a timestamp inside the window', () => {
    expect(isFreshTimestamp(now - 1000, now)).toBe(true)
    expect(isFreshTimestamp(now, now)).toBe(true)
  })

  it('rejects stale, future, and non-finite timestamps', () => {
    expect(isFreshTimestamp(now - OWNERSHIP_MAX_AGE_MS - 1, now)).toBe(false)
    // More than the tolerated skew into the future.
    expect(isFreshTimestamp(now + 120_000, now)).toBe(false)
    expect(isFreshTimestamp(Number.NaN, now)).toBe(false)
  })
})

describe('ownershipVerdict', () => {
  it('allows no proof as unverified', () => {
    expect(ownershipVerdict({ proofProvided: false, signerIsAdmin: null })).toBe('unverified')
    expect(ownershipVerdict({ proofProvided: false, signerIsAdmin: false })).toBe('unverified')
  })

  it('verifies a proof from an admin', () => {
    expect(ownershipVerdict({ proofProvided: true, signerIsAdmin: true })).toBe('verified')
  })

  it('rejects a proof that is not from an admin, or that could not be checked', () => {
    expect(ownershipVerdict({ proofProvided: true, signerIsAdmin: false })).toBe('reject')
    expect(ownershipVerdict({ proofProvided: true, signerIsAdmin: null })).toBe('reject')
  })
})
