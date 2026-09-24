import { describe, expect, it } from 'vitest'

import {
  EMAIL_CODE_MAX_ATTEMPTS,
  generateEmailCode,
  hashEmailCode,
  timingSafeEqual,
  verifyEmailCode,
  type EmailCodeRecord
} from './emailCode'

function record(overrides: Partial<EmailCodeRecord> = {}): EmailCodeRecord {
  return { hash: 'a'.repeat(64), expiresAt: 2000, attempts: 0, ...overrides }
}

describe('generateEmailCode', () => {
  it('draws a 6-digit code', () => {
    for (let i = 0; i < 20; i++) expect(generateEmailCode()).toMatch(/^\d{6}$/)
  })
})

describe('hashEmailCode', () => {
  it('is stable, case-insensitive on the address, and secret-dependent', async () => {
    const base = await hashEmailCode('Alice@Example.com ', '123456', 's')
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashEmailCode('alice@example.com', '123456', 's')).toBe(base)
    expect(await hashEmailCode('alice@example.com', '123456', 'other')).not.toBe(base)
    expect(await hashEmailCode('alice@example.com', '123457', 's')).not.toBe(base)
  })
})

describe('timingSafeEqual', () => {
  it('compares equal strings and rejects length or content differences', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('verifyEmailCode', () => {
  it('accepts a fresh matching hash', () => {
    expect(verifyEmailCode(record(), 'a'.repeat(64), 1000)).toEqual({ ok: true })
  })

  it('reports a missing record', () => {
    expect(verifyEmailCode(null, 'a'.repeat(64), 1000)).toEqual({ ok: false, reason: 'missing' })
  })

  it('reports an expired code', () => {
    expect(verifyEmailCode(record({ expiresAt: 999 }), 'a'.repeat(64), 1000)).toEqual({
      ok: false,
      reason: 'expired'
    })
  })

  it('reports a mismatch', () => {
    expect(verifyEmailCode(record(), 'b'.repeat(64), 1000)).toEqual({
      ok: false,
      reason: 'mismatch'
    })
  })

  it('spends a code that has too many wrong attempts', () => {
    expect(
      verifyEmailCode(record({ attempts: EMAIL_CODE_MAX_ATTEMPTS }), 'a'.repeat(64), 1000)
    ).toEqual({ ok: false, reason: 'too-many-attempts' })
  })
})
