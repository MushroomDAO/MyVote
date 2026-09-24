import { describe, expect, it } from 'vitest'

import { isValidSpaceId, isValidSubdomain } from './registration'

describe('isValidSubdomain', () => {
  it('accepts 3-30 char lowercase labels', () => {
    for (const ok of ['bread', 'my-dao', 'abc', 'a1b']) {
      expect(isValidSubdomain(ok)).toBe(true)
    }
  })

  it('rejects bad labels', () => {
    for (const bad of ['', 'ab', '-lead', 'trail-', 'has_underscore', 'x'.repeat(31)]) {
      expect(isValidSubdomain(bad)).toBe(false)
    }
  })

  it('normalises case before validating', () => {
    expect(isValidSubdomain('Bread')).toBe(true)
  })
})

describe('isValidSpaceId', () => {
  it('accepts ENS ids and Snapshot X hex addresses', () => {
    expect(isValidSpaceId('ens.eth')).toBe(true)
    expect(isValidSpaceId('aastar.eth')).toBe(true)
    expect(isValidSpaceId('0x012b261effbf548f2b9a495d50b81a8a7c1dd941')).toBe(true)
  })

  it('rejects empty, too-long and separator-bearing ids', () => {
    expect(isValidSpaceId('')).toBe(false)
    expect(isValidSpaceId('  ')).toBe(false)
    expect(isValidSpaceId('a/b')).toBe(false)
    expect(isValidSpaceId('a b')).toBe(false)
    expect(isValidSpaceId('x'.repeat(101))).toBe(false)
  })
})
