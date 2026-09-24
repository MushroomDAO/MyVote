import { describe, expect, it } from 'vitest'

import { domainOutcome } from './domainRegistration'

describe('domainOutcome', () => {
  it('marks the domain unmanaged when CF is not configured', () => {
    expect(domainOutcome(false, null)).toEqual({ kind: 'unmanaged' })
    // Even a (hypothetical) success result is ignored without credentials.
    expect(domainOutcome(false, { success: true })).toEqual({ kind: 'unmanaged' })
  })

  it('marks the domain active when CF registration succeeds', () => {
    expect(domainOutcome(true, { success: true })).toEqual({ kind: 'active' })
  })

  it('rolls back and surfaces the CF error when registration fails', () => {
    expect(
      domainOutcome(true, { success: false, errors: [{ message: 'domain already exists' }] })
    ).toEqual({ kind: 'rollback', detail: 'domain already exists' })
  })

  it('joins multiple CF errors and falls back when none are given', () => {
    expect(
      domainOutcome(true, { success: false, errors: [{ message: 'a' }, { message: 'b' }] })
    ).toEqual({ kind: 'rollback', detail: 'a; b' })
    expect(domainOutcome(true, { success: false })).toEqual({
      kind: 'rollback',
      detail: 'unknown error'
    })
  })
})
