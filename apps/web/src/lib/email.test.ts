import { describe, expect, it } from 'vitest'

import { isValidEmail } from './email'

describe('isValidEmail', () => {
  it('accepts ordinary addresses and trims surrounding whitespace', () => {
    expect(isValidEmail('alice@example.com')).toBe(true)
    expect(isValidEmail('  alice@example.com  ')).toBe(true)
    expect(isValidEmail('a.b+c@sub.example.co')).toBe(true)
  })

  it('rejects malformed addresses', () => {
    for (const bad of ['', 'nope', 'a@b', 'a b@c.com', '@example.com', 'a@.com']) {
      expect(isValidEmail(bad)).toBe(false)
    }
  })
})
