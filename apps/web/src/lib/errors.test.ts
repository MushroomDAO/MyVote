import { describe, expect, it } from 'vitest'

import { AppError, errorKey, resolveErrorMessage, type TranslateFn } from './errors'

const dict: Record<string, string> = {
  errVoteClockSkew: 'clock skew, check your system time',
  errVoteRejected: 'hub rejected ({status}): {detail}'
}

// Minimal vue-i18n-like translator with named interpolation.
const t: TranslateFn = (key, params) => {
  const template = dict[key]
  if (!template) return key
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

describe('errorKey', () => {
  it('maps vote and auth codes to their i18n keys', () => {
    expect(errorKey('voteRejected')).toBe('errVoteRejected')
    expect(errorKey('ssoCodeRejected')).toBe('errSsoCodeRejected')
    expect(errorKey('walletSwitchBlocked')).toBe('errWalletSwitchBlocked')
  })
})

describe('AppError', () => {
  it('carries the code, message and params', () => {
    const err = new AppError('voteRejected', 'fallback', { status: 400 })
    expect(err.code).toBe('voteRejected')
    expect(err.message).toBe('fallback')
    expect(err.params).toEqual({ status: 400 })
    expect(err).toBeInstanceOf(Error)
  })
})

describe('resolveErrorMessage', () => {
  it('translates a coded error', () => {
    expect(resolveErrorMessage(new AppError('voteClockSkew', '中文兜底'), t)).toBe(
      'clock skew, check your system time'
    )
  })

  it('interpolates params for a coded error', () => {
    const err = new AppError('voteRejected', '中文兜底', { status: 400, detail: 'no voting power' })
    expect(resolveErrorMessage(err, t)).toBe('hub rejected (400): no voting power')
  })

  it('falls back to the message when the code has no translation', () => {
    const missing: TranslateFn = (key) => key
    expect(resolveErrorMessage(new AppError('voteRejected', 'readable fallback'), missing)).toBe(
      'readable fallback'
    )
  })

  it('passes a plain Error through', () => {
    expect(resolveErrorMessage(new Error('boom'), t)).toBe('boom')
  })

  it('stringifies a non-error throw', () => {
    expect(resolveErrorMessage('oops', t)).toBe('oops')
  })
})
