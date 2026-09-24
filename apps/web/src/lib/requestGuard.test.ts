import { describe, expect, it } from 'vitest'

import { createRequestGuard } from './requestGuard'

describe('createRequestGuard', () => {
  it('treats only the newest token as current', () => {
    const guard = createRequestGuard()
    const a = guard.next()
    expect(guard.isCurrent(a)).toBe(true)

    const b = guard.next()
    expect(guard.isCurrent(a)).toBe(false)
    expect(guard.isCurrent(b)).toBe(true)
  })

  it('does not let an unrelated guard invalidate this one', () => {
    const g1 = createRequestGuard()
    const g2 = createRequestGuard()
    const a = g1.next()
    g2.next()
    expect(g1.isCurrent(a)).toBe(true)
  })
})
describe('createRequestGuard cancellation', () => {
  it('starts with a live signal', () => {
    const guard = createRequestGuard()
    expect(guard.signal).toBeInstanceOf(AbortSignal)
    expect(guard.signal.aborted).toBe(false)
  })

  it('aborts the previous request when a newer one starts', () => {
    const guard = createRequestGuard()
    const first = guard.signal

    guard.next()

    expect(first.aborted).toBe(true)
    expect(guard.signal).not.toBe(first)
    expect(guard.signal.aborted).toBe(false)
  })

  it('abort() cancels the newest request AND invalidates its token', () => {
    const guard = createRequestGuard()
    const token = guard.next()
    const signal = guard.signal
    expect(guard.isCurrent(token)).toBe(true)

    guard.abort()

    expect(signal.aborted).toBe(true)
    // Without the token bump the aborted loader would run its catch/finally.
    expect(guard.isCurrent(token)).toBe(false)
  })
})
